import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DATASET_DIR = path.join(ROOT, 'scripts/comms/datasets');
const OUTPUT_DIR = path.join(ROOT, 'artifacts/comms');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'current-metrics.json');

export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function dedupeKey(event) {
  if (event.type !== 'gateway_event') return null;
  const runId = event.runId ?? '';
  const sessionKey = event.sessionKey ?? '';
  const seq = event.seq ?? '';
  const state = event.state ?? '';
  if (!runId && !sessionKey && !seq && !state) return null;
  return `${runId}|${sessionKey}|${seq}|${state}`;
}

export function calculateScenarioMetrics(events) {
  let totalGatewayEvents = 0;
  let uniqueGatewayEvents = 0;
  let fanoutTotal = 0;
  let duplicateGatewayEvents = 0;
  let gatewayReconnectCount = 0;
  let messageLossCount = 0;
  let messageOrderViolationCount = 0;
  let rpcTimeoutCount = 0;
  const rpcLatencies = [];
  const dedupeSet = new Set();
  const historyInFlight = new Map();
  let historyInflightMax = 0;
  let historyLoadCount = 0;

  const sorted = [...events].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const startTs = sorted.length > 0 ? (sorted[0].ts ?? 0) : 0;
  const endTs = sorted.length > 0 ? (sorted[sorted.length - 1].ts ?? 0) : 0;
  const durationSec = Math.max(1, endTs - startTs);

  for (const event of sorted) {
    if (event.type === 'gateway_event') {
      totalGatewayEvents += 1;
      fanoutTotal += Number(event.fanout ?? 1);
      const key = dedupeKey(event);
      if (!key || !dedupeSet.has(key)) {
        uniqueGatewayEvents += 1;
        if (key) dedupeSet.add(key);
      } else {
        duplicateGatewayEvents += 1;
      }
      continue;
    }

    if (event.type === 'history_load') {
      const sessionKey = String(event.sessionKey ?? 'unknown');
      if (event.action === 'start') {
        const next = (historyInFlight.get(sessionKey) ?? 0) + 1;
        historyInFlight.set(sessionKey, next);
        historyInflightMax = Math.max(historyInflightMax, next);
        historyLoadCount += 1;
      } else if (event.action === 'end') {
        const current = historyInFlight.get(sessionKey) ?? 0;
        historyInFlight.set(sessionKey, Math.max(0, current - 1));
      }
      continue;
    }

    if (event.type === 'rpc') {
      const latency = Number(event.latencyMs ?? 0);
      if (latency > 0) rpcLatencies.push(latency);
      if (event.timeout === true) rpcTimeoutCount += 1;
      continue;
    }

    if (event.type === 'gateway_reconnect') {
      gatewayReconnectCount += 1;
      continue;
    }

    if (event.type === 'message') {
      if (event.lost === true) messageLossCount += 1;
      if (event.orderViolation === true) messageOrderViolationCount += 1;
    }
  }

  return {
    duplicate_event_rate: totalGatewayEvents > 0 ? duplicateGatewayEvents / totalGatewayEvents : 0,
    event_fanout_ratio: uniqueGatewayEvents > 0 ? fanoutTotal / uniqueGatewayEvents : 0,
    history_inflight_max: historyInflightMax,
    history_load_qps: historyLoadCount / durationSec,
    rpc_p50_ms: percentile(rpcLatencies, 50),
    rpc_p95_ms: percentile(rpcLatencies, 95),
    rpc_timeout_rate: rpcLatencies.length > 0 ? rpcTimeoutCount / rpcLatencies.length : 0,
    gateway_reconnect_count: gatewayReconnectCount,
    message_loss_count: messageLossCount,
    message_order_violation_count: messageOrderViolationCount,
    _meta: {
      duration_sec: durationSec,
      total_gateway_events: totalGatewayEvents,
      unique_gateway_events: uniqueGatewayEvents,
      total_rpc_calls: rpcLatencies.length,
    },
  };
}

export function aggregateMetrics(metricsList) {
  if (metricsList.length === 0) {
    return calculateScenarioMetrics([]);
  }
  const sum = (key) => metricsList.reduce((acc, item) => acc + Number(item[key] ?? 0), 0);
  return {
    duplicate_event_rate: sum('duplicate_event_rate') / metricsList.length,
    event_fanout_ratio: sum('event_fanout_ratio') / metricsList.length,
    history_inflight_max: Math.max(...metricsList.map((m) => Number(m.history_inflight_max ?? 0))),
    history_load_qps: sum('history_load_qps') / metricsList.length,
    rpc_p50_ms: sum('rpc_p50_ms') / metricsList.length,
    rpc_p95_ms: sum('rpc_p95_ms') / metricsList.length,
    rpc_timeout_rate: sum('rpc_timeout_rate') / metricsList.length,
    gateway_reconnect_count: Math.round(sum('gateway_reconnect_count')),
    message_loss_count: Math.round(sum('message_loss_count')),
    message_order_violation_count: Math.round(sum('message_order_violation_count')),
  };
}

export async function loadScenario(fileName) {
  const fullPath = path.join(DATASET_DIR, fileName);
  const raw = await readFile(fullPath, 'utf8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

export async function main() {
  const argScenario = process.argv.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] ?? 'all';
  const files = (await readdir(DATASET_DIR)).filter((name) => name.endsWith('.jsonl')).sort();
  const selectedFiles = argScenario === 'all'
    ? files
    : files.filter((name) => name === `${argScenario}.jsonl`);

  if (selectedFiles.length === 0) {
    throw new Error(`No dataset found for scenario "${argScenario}"`);
  }

  const scenarios = {};
  for (const fileName of selectedFiles) {
    const scenarioName = fileName.replace(/\.jsonl$/, '');
    const events = await loadScenario(fileName);
    scenarios[scenarioName] = calculateScenarioMetrics(events);
  }

  const aggregate = aggregateMetrics(Object.values(scenarios));
  const output = {
    generated_at: new Date().toISOString(),
    scenario: argScenario,
    scenarios,
    aggregate,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote comms replay metrics to ${OUTPUT_FILE}`);
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntrypoint) {
  main().catch((error) => {
    console.error('[comms:replay] failed:', error);
    process.exitCode = 1;
  });
}
