import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const CURRENT_FILE = path.join(ROOT, 'artifacts/comms/current-metrics.json');
const BASELINE_FILE = path.join(ROOT, 'scripts/comms/baseline/metrics.baseline.json');
const OUTPUT_DIR = path.join(ROOT, 'artifacts/comms');
const REPORT_FILE = path.join(OUTPUT_DIR, 'compare-report.md');

const HARD_THRESHOLDS = {
  duplicate_event_rate: 0.005,
  event_fanout_ratio: 1.2,
  history_inflight_max: 1,
  rpc_timeout_rate: 0.01,
  message_loss_count: 0,
  message_order_violation_count: 0,
};

const RELATIVE_THRESHOLDS = {
  history_load_qps: 0.10,
  rpc_p95_ms: 0.15,
};

const REQUIRED_SCENARIOS = [
  'gateway-restart-during-run',
  'happy-path-chat',
  'history-overlap-guard',
  'invalid-config-patch-recovered',
  'multi-agent-channel-switch',
  'network-degraded',
];

function ratioDelta(current, baseline) {
  if (!Number.isFinite(baseline) || baseline === 0) return current === 0 ? 0 : Infinity;
  return (current - baseline) / baseline;
}

function fmtPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : String(value);
}

export function evaluateReport(current, baseline) {
  const c = current.aggregate ?? {};
  const b = baseline.aggregate ?? {};
  const scenarios = current.scenarios ?? {};
  const failures = [];
  const rows = [];

  for (const scenario of REQUIRED_SCENARIOS) {
    if (!scenarios[scenario]) {
      failures.push(`missing scenario: ${scenario}`);
      rows.push(`| scenario:${scenario} | missing | required | FAIL |`);
      continue;
    }
    const scenarioMetrics = scenarios[scenario];
    for (const [metric, threshold] of Object.entries(HARD_THRESHOLDS)) {
      const cv = Number(scenarioMetrics[metric] ?? 0);
      const pass = cv <= threshold;
      if (!pass) failures.push(`scenario:${scenario} ${metric}=${cv} > ${threshold}`);
      rows.push(`| ${scenario}.${metric} | ${fmtNumber(cv)} | <= ${threshold} | ${pass ? 'PASS' : 'FAIL'} |`);
    }
  }

  for (const [metric, threshold] of Object.entries(HARD_THRESHOLDS)) {
    const cv = Number(c[metric] ?? 0);
    const pass = cv <= threshold;
    if (!pass) failures.push(`${metric}=${cv} > ${threshold}`);
    rows.push(`| ${metric} | ${fmtNumber(cv)} | <= ${threshold} | ${pass ? 'PASS' : 'FAIL'} |`);
  }

  for (const [metric, maxIncrease] of Object.entries(RELATIVE_THRESHOLDS)) {
    const cv = Number(c[metric] ?? 0);
    const bv = Number(b[metric] ?? 0);
    const delta = ratioDelta(cv, bv);
    const pass = delta <= maxIncrease;
    if (!pass) failures.push(`${metric} delta=${delta} > ${maxIncrease}`);
    rows.push(`| ${metric} | ${fmtNumber(cv)} (baseline ${fmtNumber(bv)}) | delta <= ${fmtPercent(maxIncrease)} | ${pass ? 'PASS' : 'FAIL'} (${fmtPercent(delta)}) |`);
  }

  return { failures, rows };
}

export async function main() {
  const current = JSON.parse(await readFile(CURRENT_FILE, 'utf8'));
  const baseline = JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
  const { failures, rows } = evaluateReport(current, baseline);

  const report = [
    '# Comms Regression Report',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Result: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '| Metric | Current | Threshold | Status |',
    '|---|---:|---:|---|',
    ...rows,
    '',
  ].join('\n');

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(REPORT_FILE, report);
  console.log(report);
  console.log(`\nWrote comparison report to ${REPORT_FILE}`);

  if (failures.length > 0) {
    console.error('\nThreshold failures:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntrypoint) {
  main().catch((error) => {
    console.error('[comms:compare] failed:', error);
    process.exitCode = 1;
  });
}
