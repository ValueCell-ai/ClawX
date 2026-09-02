import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RawMessage } from '@shared/chat/types';
import type { CronJob, CronJobDelivery, CronSchedule } from '@shared/types/cron';
import type { GatewayManager } from '../gateway/manager';
import { mutateOpenClawConfig } from '../gateway/config-delivery';
import { getOpenClawConfigDir } from '../utils/paths';
import { resolveAgentIdFromChannel } from '../utils/agent-config';
import { toOpenClawChannelType, toUiChannelType } from '../utils/channel-alias';
import { resolveAccountIdFromSessionHistory } from '../utils/session-util';
import { loadSessionTranscriptByKey } from './sessions-api';
import { isRecord } from './payload-utils';

interface GatewayCronJob {
  id: string;
  declarationKey?: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  agentId?: string;
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

interface CronSessionFallbackMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isError?: boolean;
}

type JsonRecord = Record<string, unknown>;
const OPENCLAW_CRON_SUMMARY_TRUNCATION_MIN_CHARS = 2_000;

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;
  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;
  if (parts.length === 4) return { agentId, jobId };
  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }
  return null;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function getMessageText(content: RawMessage['content']): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const value = block as { type?: unknown; text?: unknown };
      return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getFinalAssistantReply(messages: RawMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const text = getMessageText(message.content);
    if (text) return text;
  }
  return '';
}

function isBoundedCronSummary(summary: string): boolean {
  return summary.length >= OPENCLAW_CRON_SUMMARY_TRUNCATION_MIN_CHARS
    && summary.endsWith('…');
}

function resolveCronRunSessionKey(
  parsed: CronSessionKeyParts,
  entry: CronRunLogEntry,
): string | null {
  const explicitSessionKey = typeof entry.sessionKey === 'string' ? entry.sessionKey.trim() : '';
  if (explicitSessionKey && parseCronSessionKey(explicitSessionKey)?.runSessionId) {
    return explicitSessionKey;
  }
  const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : '';
  if (!sessionId) return null;
  return `agent:${parsed.agentId}:cron:${parsed.jobId}:run:${sessionId}`;
}

async function loadFullCronRunReplies(
  gatewayManager: GatewayManager,
  parsed: CronSessionKeyParts,
  runs: CronRunLogEntry[],
): Promise<Map<CronRunLogEntry, string>> {
  const replies = new Map<CronRunLogEntry, string>();
  await Promise.all(runs.map(async (entry) => {
    const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    if (!isBoundedCronSummary(summary)) return;

    const runSessionKey = resolveCronRunSessionKey(parsed, entry);
    if (!runSessionKey) return;
    const history = await gatewayManager.rpc('chat.history', {
      sessionKey: runSessionKey,
      limit: 1_000,
    }).catch(() => null) as { messages?: unknown } | null;
    const transcript = Array.isArray(history?.messages)
      ? history.messages.filter((message): message is RawMessage => isRecord(message))
      : (await loadSessionTranscriptByKey(runSessionKey, 1_000) ?? []);
    if (!transcript?.length) return;

    const fullReply = getFinalAssistantReply(transcript);
    const summaryPrefix = summary.slice(0, -1);
    if (fullReply.length > summaryPrefix.length && fullReply.startsWith(summaryPrefix)) {
      replies.set(entry, fullReply);
    }
  }));
  return replies;
}

function buildCronRunMessage(
  entry: CronRunLogEntry,
  index: number,
  fullReply?: string,
): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = fullReply?.trim() || summary || error;
  if (!content) {
    content = status === 'error' ? 'Scheduled task failed.' : 'Scheduled task completed.';
  }
  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) meta.push(`Model: ${entry.provider}/${entry.model}`);
  else if (entry.model) meta.push(`Model: ${entry.model}`);
  if (meta.length > 0) content = `${content}\n\n${meta.join(' | ')}`;

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readLegacyCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines.
    }
  }
  return entries;
}

async function readCronRunHistory(
  gatewayManager: GatewayManager,
  jobId: string,
  limit: number,
): Promise<CronRunLogEntry[]> {
  try {
    const result = await gatewayManager.rpc<{ entries?: CronRunLogEntry[] }>('cron.runs', {
      id: jobId,
      limit,
      sortDir: 'asc',
    }, 8000);
    if (Array.isArray(result?.entries)) return result.entries;
  } catch {
    // OpenClaw versions before SQLite cron history may not expose cron.runs.
  }
  return readLegacyCronRunLog(jobId);
}

async function readSessionStoreEntry(
  gatewayManager: GatewayManager,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const result = await gatewayManager.rpc('sessions.describe', {
      key: sessionKey,
    }) as unknown;
    if (!isRecord(result)) return undefined;
    return isRecord(result.session) ? result.session : result;
  } catch {
    return undefined;
  }
}

function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  fullReplies?: Map<CronRunLogEntry, string>;
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): CronSessionFallbackMessage[] {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId || entry.sessionKey === `${params.sessionKey}`;
    })
    .sort((a, b) => {
      const left = normalizeTimestampMs(a.ts) ?? normalizeTimestampMs(a.runAtMs) ?? 0;
      const right = normalizeTimestampMs(b.ts) ?? normalizeTimestampMs(b.runAtMs) ?? 0;
      return left - right;
    });

  const messages: CronSessionFallbackMessage[] = [];
  const prompt = params.job?.payload?.message || params.job?.payload?.text || '';
  const taskName = params.job?.name?.trim()
    || params.sessionEntry?.label?.replace(/^Cron:\s*/, '').trim()
    || '';
  const firstRelevantTimestamp = matchingRuns.length > 0
    ? (normalizeTimestampMs(matchingRuns[0]?.runAtMs) ?? normalizeTimestampMs(matchingRuns[0]?.ts))
    : (normalizeTimestampMs(params.job?.state?.runningAtMs) ?? params.sessionEntry?.updatedAt);

  if (taskName || prompt) {
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'user',
      content: prompt || taskName,
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  matchingRuns.forEach((entry, index) => {
    const message = buildCronRunMessage(entry, index, params.fullReplies?.get(entry));
    if (message) messages.push(message);
  });

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'assistant',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

function getUnsupportedCronDeliveryError(_channel: string | undefined): string | null {
  return null;
}

function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: CronJobDelivery['mode'] = 'none',
): CronJobDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') return { mode: fallbackMode };

  const delivery = rawDelivery as JsonRecord;
  const mode = delivery.mode === 'announce' ? 'announce' : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim() ? delivery.to.trim() : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;

  if (mode === 'announce' && !channel) return { mode: 'none' };
  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function normalizeCronSchedule(schedule: GatewayCronJob['schedule']): CronJob['schedule'] {
  if (schedule.kind === 'at' && typeof schedule.at === 'string') {
    return { kind: 'at', at: schedule.at };
  }
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return {
      kind: 'every',
      everyMs: schedule.everyMs,
      ...(typeof (schedule as CronSchedule & { anchorMs?: unknown }).anchorMs === 'number'
        ? { anchorMs: (schedule as CronSchedule & { anchorMs: number }).anchorMs }
        : {}),
    };
  }
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') {
    return { kind: 'cron', expr: schedule.expr, ...(schedule.tz ? { tz: schedule.tz } : {}) };
  }
  return typeof schedule.expr === 'string' ? schedule.expr : '';
}

/**
 * Normalize a UI-supplied schedule (plain cron string or structured CronSchedule)
 * into the structured form the Gateway expects. Plain strings become a cron
 * schedule; structured `at` / `every` / `cron` objects pass through after a
 * minimal shape check.
 */
function normalizeScheduleInput(schedule: unknown): CronSchedule {
  if (typeof schedule === 'string') {
    return { kind: 'cron', expr: schedule };
  }
  if (schedule && typeof schedule === 'object') {
    const record = schedule as Record<string, unknown>;
    if (record.kind === 'at' && typeof record.at === 'string' && record.at.trim()) {
      return { kind: 'at', at: record.at };
    }
    if (record.kind === 'every' && typeof record.everyMs === 'number' && Number.isFinite(record.everyMs)) {
      return {
        kind: 'every',
        everyMs: record.everyMs,
        ...(typeof record.anchorMs === 'number' ? { anchorMs: record.anchorMs } : {}),
      };
    }
    if (record.kind === 'cron' && typeof record.expr === 'string') {
      return { kind: 'cron', expr: record.expr, ...(typeof record.tz === 'string' && record.tz ? { tz: record.tz } : {}) };
    }
  }
  throw new Error('Invalid schedule: expected a cron expression string or a CronSchedule object');
}

function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') return {};

  const delivery = rawDelivery as JsonRecord;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim() ? delivery.mode.trim() : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) patch.to = typeof delivery.to === 'string' ? delivery.to : '';
  if ('accountId' in delivery) patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId : '';
  return patch;
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };
  if ('schedule' in patch && patch.schedule !== undefined) patch.schedule = normalizeScheduleInput(patch.schedule);
  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }
  if ('delivery' in patch) patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  if ('agentId' in patch) {
    patch.agentId = typeof patch.agentId === 'string' && patch.agentId.trim() ? patch.agentId.trim() : 'main';
  }
  return patch;
}

function heartbeatAgentId(job: GatewayCronJob): string | null {
  if (job.payload?.kind !== 'heartbeat') return null;
  if (typeof job.agentId === 'string' && job.agentId.trim()) return job.agentId.trim();
  const declarationKey = typeof job.declarationKey === 'string' ? job.declarationKey.trim() : '';
  return declarationKey.startsWith('heartbeat:') && declarationKey.length > 'heartbeat:'.length
    ? declarationKey.slice('heartbeat:'.length)
    : null;
}

function heartbeatInterval(job: GatewayCronJob): string {
  const everyMs = job.schedule?.kind === 'every' ? job.schedule.everyMs : undefined;
  if (typeof everyMs !== 'number' || !Number.isFinite(everyMs) || everyMs <= 0) return '30m';
  if (everyMs % 3_600_000 === 0) return `${everyMs / 3_600_000}h`;
  if (everyMs % 60_000 === 0) return `${everyMs / 60_000}m`;
  if (everyMs % 1_000 === 0) return `${everyMs / 1_000}s`;
  return `${Math.round(everyMs)}ms`;
}

async function toggleHeartbeatMonitor(
  jobs: GatewayCronJob[],
  selectedJob: GatewayCronJob,
  enabled: boolean,
): Promise<void> {
  const selectedAgentId = heartbeatAgentId(selectedJob);
  if (!selectedAgentId) throw new Error('Heartbeat monitor is missing its agent owner');

  await mutateOpenClawConfig((config) => {
    const agents = isRecord(config.agents) ? config.agents : {};
    const entries = isRecord(agents.entries) ? agents.entries : {};

    // A per-agent heartbeat block makes OpenClaw select only explicitly
    // configured heartbeat agents. Materialize every existing monitor first so
    // toggling one agent cannot accidentally remove sibling monitors.
    for (const job of jobs) {
      const agentId = heartbeatAgentId(job);
      if (!agentId) continue;
      const entry = isRecord(entries[agentId]) ? entries[agentId] : {};
      const heartbeat = isRecord(entry.heartbeat) ? entry.heartbeat : {};
      heartbeat.every = agentId === selectedAgentId
        ? (enabled ? heartbeatInterval(job) : '0m')
        : (job.enabled ? heartbeatInterval(job) : '0m');
      entry.heartbeat = heartbeat;
      entries[agentId] = entry;
    }

    agents.entries = entries;
    config.agents = agents;
  });
}

function transformCronJob(job: GatewayCronJob): CronJob {
  const message = job.payload?.message || job.payload?.text || '';
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType ? { ...gatewayDelivery, channel: channelType } : gatewayDelivery;
  const target = channelType
    ? {
      channelType,
      channelId: delivery.accountId || gatewayDelivery.channel || channelType,
      channelName: channelType,
      recipient: delivery.to,
    }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : undefined;
  const agentId = (job as unknown as { agentId?: string }).agentId || 'main';

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: normalizeCronSchedule(job.schedule),
    delivery,
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
    agentId,
  };
}

async function listCronJobs(gatewayManager: GatewayManager): Promise<CronJob[]> {
  let jobs: GatewayCronJob[] = [];
  let usedFallback = false;

  try {
    const result = await gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
    const data = result as { jobs?: GatewayCronJob[] };
    jobs = data?.jobs ?? (Array.isArray(result) ? result as GatewayCronJob[] : []);
  } catch {
    try {
      const cronJsonPath = join(getOpenClawConfigDir(), 'cron', 'cron.json');
      const raw = await readFile(cronJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      jobs = (Array.isArray(parsed) ? parsed : (parsed?.jobs ?? [])) as GatewayCronJob[];
      usedFallback = true;
    } catch {
      // No fallback data available.
    }
  }

  if (!usedFallback && jobs.length > 0) {
    repairCronJobsInBackground(gatewayManager, jobs);
  }

  return jobs.map((job) => ({ ...transformCronJob(job), ...(usedFallback ? { _fromFallback: true } : {}) }));
}

function repairCronJobsInBackground(gatewayManager: GatewayManager, jobs: GatewayCronJob[]): void {
  const jobsToRepairDelivery = jobs.filter((job) => {
    const isIsolatedAgent = (job.sessionTarget === 'isolated' || !job.sessionTarget)
      && job.payload?.kind === 'agentTurn';
    return isIsolatedAgent && job.delivery?.mode === 'announce' && !job.delivery?.channel;
  });

  if (jobsToRepairDelivery.length > 0) {
    void (async () => {
      for (const job of jobsToRepairDelivery) {
        try {
          await gatewayManager.rpc('cron.update', {
            id: job.id,
            patch: { delivery: { mode: 'none' } },
          });
        } catch {
          // ignore per-job repair failure
        }
      }
    })();
    for (const job of jobsToRepairDelivery) {
      job.delivery = { mode: 'none' };
      if (job.state?.lastError?.includes('Channel is required')) {
        job.state.lastError = undefined;
        job.state.lastStatus = 'ok';
      }
    }
  }

  const jobsToRepairAgent = jobs.filter((job) => {
    const jobAgentId = (job as unknown as { agentId?: string }).agentId;
    return (
      (job.sessionTarget === 'isolated' || !job.sessionTarget)
      && job.payload?.kind === 'agentTurn'
      && job.delivery?.mode === 'announce'
      && job.delivery?.channel
      && jobAgentId === undefined
    );
  });

  if (jobsToRepairAgent.length > 0) {
    void (async () => {
      for (const job of jobsToRepairAgent) {
        try {
          const channel = toOpenClawChannelType(job.delivery!.channel!);
          const accountId = job.delivery!.accountId;
          const toAddress = job.delivery!.to;
          let correctAgentId = await resolveAgentIdFromChannel(channel, accountId);
          let resolvedAccountId: string | null = null;
          if (!correctAgentId && !accountId && toAddress) {
            resolvedAccountId = await resolveAccountIdFromSessionHistory(
              toAddress,
              channel,
              gatewayManager,
            );
            if (resolvedAccountId) {
              correctAgentId = await resolveAgentIdFromChannel(channel, resolvedAccountId);
            }
          }
          if (correctAgentId) {
            const patch: Record<string, unknown> = { agentId: correctAgentId };
            if (resolvedAccountId && !accountId) patch.delivery = { accountId: resolvedAccountId };
            await gatewayManager.rpc('cron.update', { id: job.id, patch });
            (job as unknown as { agentId: string }).agentId = correctAgentId;
            if (resolvedAccountId && !accountId && job.delivery) job.delivery.accountId = resolvedAccountId;
          }
        } catch {
          // ignore per-job repair failure
        }
      }
    })();
  }
}

function getId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  const id = body.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('id is required');
  return id.trim();
}

export function createCronApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['cron'] {
  return {
    list: async () => listCronJobs(gatewayManager),
    create: async (payload) => {
      const input = payload;
      const agentId = typeof input.agentId === 'string' && input.agentId.trim() ? input.agentId.trim() : 'main';
      const delivery = normalizeCronDelivery(input.delivery);
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(delivery.channel);
      if (delivery.mode === 'announce' && unsupportedDeliveryError) {
        throw new Error(unsupportedDeliveryError);
      }
      const result = await gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: normalizeScheduleInput(input.schedule),
        payload: { kind: 'agentTurn', message: input.message },
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        agentId,
        delivery,
      });
      if (!result || typeof result !== 'object') {
        throw new Error('Cron create returned an invalid job');
      }
      return transformCronJob(result as GatewayCronJob);
    },
    update: async (payload) => {
      const body = payload;
      const id = getId(body);
      const input = isRecord(body.input) ? body.input : {};
      const patch = buildCronUpdatePatch(input);
      delete patch.id;
      delete patch.input;
      const deliveryPatch = patch.delivery && typeof patch.delivery === 'object'
        ? patch.delivery as Record<string, unknown>
        : undefined;
      const deliveryChannel = typeof deliveryPatch?.channel === 'string' && deliveryPatch.channel.trim()
        ? deliveryPatch.channel.trim()
        : undefined;
      const deliveryMode = typeof deliveryPatch?.mode === 'string' && deliveryPatch.mode.trim()
        ? deliveryPatch.mode.trim()
        : undefined;
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(deliveryChannel);
      if (unsupportedDeliveryError && deliveryMode !== 'none') {
        throw new Error(unsupportedDeliveryError);
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      if (!result || typeof result !== 'object') {
        throw new Error('Cron update returned an invalid job');
      }
      return transformCronJob(result as GatewayCronJob);
    },
    delete: async (payload) => gatewayManager.rpc('cron.remove', { id: getId(payload) }),
    toggle: async (payload) => {
      const body = payload;
      const id = getId(body);
      const listResult = await gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
      const jobs = (listResult as { jobs?: GatewayCronJob[] })?.jobs
        ?? (Array.isArray(listResult) ? listResult as GatewayCronJob[] : []);
      const job = jobs.find((item) => item.id === id);
      if (job && heartbeatAgentId(job)) {
        await toggleHeartbeatMonitor(jobs, job, body.enabled === true);
        return { success: true };
      }
      return gatewayManager.rpc('cron.update', {
        id,
        patch: { enabled: body.enabled === true },
      });
    },
    trigger: async (payload) => gatewayManager.rpc('cron.run', { id: getId(payload), mode: 'force' }),
    sessionHistory: async (payload) => {
      const body = payload;
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      const parsedSession = parseCronSessionKey(sessionKey);
      if (!parsedSession) return { success: false, error: `Invalid cron sessionKey: ${sessionKey}` };

      const rawLimit = typeof body.limit === 'number' ? body.limit : Number(body.limit || 200);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 200;
      const [jobsResult, runs, sessionEntry] = await Promise.all([
        gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000)
          .catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunHistory(gatewayManager, parsedSession.jobId, limit),
        readSessionStoreEntry(gatewayManager, sessionKey),
      ]);
      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((item) => item.id === parsedSession.jobId);
      const fullReplies = await loadFullCronRunReplies(gatewayManager, parsedSession, runs);
      return {
        messages: buildCronSessionFallbackMessages({
          sessionKey,
          job,
          runs,
          fullReplies,
          sessionEntry: sessionEntry ? {
            label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
            updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
          } : undefined,
          limit,
        }),
      };
    },
    deliveryTargets: async () => ({ success: true, targets: [] }),
  };
}
