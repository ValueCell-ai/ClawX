import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';
import { resolveAccountIdFromSessionHistory } from '../../utils/session-util';
import { toOpenClawChannelType, toUiChannelType } from '../../utils/channel-alias';
import { resolveAgentIdFromChannel } from '../../utils/agent-config';

/**
 * Find agentId from session history by delivery "to" address.
 * Efficiently searches only agent session directories for matching deliveryContext.to.
 */
interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
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
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
  isError?: boolean;
}

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;

  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;

  if (parts.length === 4) {
    return { agentId, jobId };
  }

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
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function buildCronRunMessage(entry: CronRunLogEntry, index: number): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;

  if (!content) {
    content = status === 'error'
      ? 'Scheduled task failed.'
      : 'Scheduled task completed.';
  }

  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) {
    meta.push(`Model: ${entry.provider}/${entry.model}`);
  } else if (entry.model) {
    meta.push(`Model: ${entry.model}`);
  }
  if (meta.length > 0) {
    content = `${content}\n\n${meta.join(' | ')}`;
  }

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: status === 'error' ? 'system' : 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
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
      // Ignore malformed log lines so one bad entry does not hide the rest.
    }
  }
  return entries;
}

async function readSessionStoreEntry(
  agentId: string,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  const storePath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object') {
      return directEntry as Record<string, unknown>;
    }

    const sessions = (store as { sessions?: unknown }).sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object') {
        return arrayEntry as Record<string, unknown>;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): CronSessionFallbackMessage[] {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId
        || entry.sessionKey === `${params.sessionKey}`;
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
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  matchingRuns.forEach((entry, index) => {
    const message = buildCronRunMessage(entry, index);
    if (message) messages.push(message);
  });

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'system',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    } else if (messages.length === 0) {
      messages.push({
        id: `cron-empty-${parsed.jobId}`,
        role: 'system',
        content: 'No chat transcript is available for this scheduled task yet.',
        timestamp: params.sessionEntry?.updatedAt ?? Date.now(),
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

type JsonRecord = Record<string, unknown>;
type GatewayCronDelivery = NonNullable<GatewayCronJob['delivery']>;

function getUnsupportedCronDeliveryError(_channel: string | undefined): string | null {
  // Channel support is gated by the frontend whitelist (TESTED_CRON_DELIVERY_CHANNELS).
  // No per-channel backend blocks are needed.
  return null;
}

function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: GatewayCronDelivery['mode'] = 'none',
): GatewayCronDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return { mode: fallbackMode };
  }

  const delivery = rawDelivery as JsonRecord;
  const mode = typeof delivery.mode === 'string' && delivery.mode.trim()
    ? delivery.mode.trim()
    : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim()
    ? delivery.to.trim()
    : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;

  if (mode === 'announce' && !channel) {
    return { mode: 'none' };
  }

  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return {};
  }

  const delivery = rawDelivery as JsonRecord;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim()
      ? delivery.mode.trim()
      : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) {
    patch.to = typeof delivery.to === 'string' ? delivery.to : '';
  }
  if ('accountId' in delivery) {
    patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId : '';
  }
  return patch;
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };

  if (typeof patch.schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: patch.schedule };
  }

  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }

  if ('delivery' in patch) {
    patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  }

  if ('agentId' in patch) {
    const agentId = typeof patch.agentId === 'string' && patch.agentId.trim()
      ? patch.agentId.trim()
      : 'main';
    patch.agentId = agentId;
    // Keep sessionTarget as isolated when agentId changes
  }

  return patch;
}

function transformCronJob(job: GatewayCronJob) {
  const message = job.payload?.message || job.payload?.text || '';
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType
    ? { ...gatewayDelivery, channel: channelType }
    : gatewayDelivery;
  const target = channelType
    ? {
      channelType,
      channelId: delivery.accountId || gatewayDelivery.channel,
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
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  // Parse agentId from the job's agentId field
  const agentId = (job as unknown as { agentId?: string }).agentId || 'main';

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule,
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

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cron/session-history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const parsedSession = parseCronSessionKey(sessionKey);
    if (!parsedSession) {
      sendJson(res, 400, { success: false, error: `Invalid cron sessionKey: ${sessionKey}` });
      return true;
    }

    const rawLimit = Number(url.searchParams.get('limit') || '200');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 200;

    try {
      const [jobsResult, runs, sessionEntry] = await Promise.all([
        ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000)
          .catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunLog(parsedSession.jobId),
        readSessionStoreEntry(parsedSession.agentId, sessionKey),
      ]);

      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((item) => item.id === parsedSession.jobId);
      const messages = buildCronSessionFallbackMessages({
        sessionKey,
        job,
        runs,
        sessionEntry: sessionEntry ? {
          label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
          updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
        } : undefined,
        limit,
      });

      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      let jobs: GatewayCronJob[] = [];
      let usedFallback = false;

      try {
        // 8s timeout — fail fast when Gateway is busy with AI tasks.
        const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
        const data = result as { jobs?: GatewayCronJob[] };
        jobs = data?.jobs ?? (Array.isArray(result) ? result as GatewayCronJob[] : []);

        // DEBUG: log name and agentId for each job
        console.debug('Fetched cron jobs from Gateway:');
        for (const job of jobs) {
          const jobAgentId = (job as unknown as { agentId?: string }).agentId;
          const deliveryInfo = job.delivery ? `delivery={mode:${job.delivery.mode}, channel:${job.delivery.channel || '(none)'}, accountId:${job.delivery.accountId || '(none)'}, to:${job.delivery.to || '(none)'}}` : 'delivery=(none)';
          console.debug(`  - name: "${job.name}", agentId: "${jobAgentId || '(undefined)'}", ${deliveryInfo}, sessionTarget: "${job.sessionTarget || '(none)'}", payload.kind: "${job.payload?.kind || '(none)'}"`);
        }
      } catch {
        // Fallback: read cron.json directly when Gateway RPC fails/times out.
        try {
          const cronJsonPath = join(getOpenClawConfigDir(), 'cron', 'cron.json');
          const raw = await readFile(cronJsonPath, 'utf-8');
          const parsed = JSON.parse(raw);
          const fileJobs = Array.isArray(parsed) ? parsed : (parsed?.jobs ?? []);
          jobs = fileJobs as GatewayCronJob[];
          usedFallback = true;
        } catch {
          // No fallback data available either
        }
      }

      // Run repair in background — don't block the response.
      if (!usedFallback && jobs.length > 0) {
        // Repair 1: delivery channel missing
        const jobsToRepairDelivery = jobs.filter((job) => {
          const isIsolatedAgent =
            (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
            job.payload?.kind === 'agentTurn';
          return (
            isIsolatedAgent &&
            job.delivery?.mode === 'announce' &&
            !job.delivery?.channel
          );
        });
        if (jobsToRepairDelivery.length > 0) {
          // Fire-and-forget: repair in background
          void (async () => {
            for (const job of jobsToRepairDelivery) {
              try {
                await ctx.gatewayManager.rpc('cron.update', {
                  id: job.id,
                  patch: { delivery: { mode: 'none' } },
                });
              } catch {
                // ignore per-job repair failure
              }
            }
          })();
          // Optimistically fix the response data
          for (const job of jobsToRepairDelivery) {
            job.delivery = { mode: 'none' };
            if (job.state?.lastError?.includes('Channel is required')) {
              job.state.lastError = undefined;
              job.state.lastStatus = 'ok';
            }
          }
        }

        // Repair 2: agentId is undefined for jobs with announce delivery
        // Only repair undefined -> inferred agent, NOT main -> inferred agent
        const jobsToRepairAgent = jobs.filter((job) => {
          const jobAgentId = (job as unknown as { agentId?: string }).agentId;
          return (
            (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
            job.payload?.kind === 'agentTurn' &&
            job.delivery?.mode === 'announce' &&
            job.delivery?.channel &&
            jobAgentId === undefined  // Only repair when agentId is completely undefined
          );
        });
        if (jobsToRepairAgent.length > 0) {
          console.debug(`Found ${jobsToRepairAgent.length} jobs needing agent repair:`);
          for (const job of jobsToRepairAgent) {
            console.debug(`  - Job "${job.name}" (id: ${job.id}): current agentId="${(job as unknown as { agentId?: string }).agentId || '(undefined)'}", channel="${job.delivery?.channel}", accountId="${job.delivery?.accountId || '(none)'}"`);
          }
          // Fire-and-forget: repair in background
          void (async () => {
            for (const job of jobsToRepairAgent) {
              try {
                const channel = toOpenClawChannelType(job.delivery!.channel!);
                const accountId = job.delivery!.accountId;
                const toAddress = job.delivery!.to;

                // Try 1: resolve from channel + accountId binding
                let correctAgentId = await resolveAgentIdFromChannel(channel, accountId);

                // If no accountId, try to resolve it from session history using "to" address, then get agentId
                let resolvedAccountId: string | null = null;
                if (!correctAgentId && !accountId && toAddress) {
                  console.debug(`No binding found for channel="${channel}", accountId="${accountId || '(none)'}", trying session history for to="${toAddress}"`);
                  resolvedAccountId = await resolveAccountIdFromSessionHistory(toAddress, channel);
                  if (resolvedAccountId) {
                    console.debug(`Resolved accountId="${resolvedAccountId}" from session history, now resolving agentId`);
                    correctAgentId = await resolveAgentIdFromChannel(channel, resolvedAccountId);
                  }
                }

                if (correctAgentId) {
                  console.debug(`Repairing job "${job.name}": agentId "${(job as unknown as { agentId?: string }).agentId || '(undefined)'}" -> "${correctAgentId}"`);
                  // When accountId was resolved via to address, include it in the patch
                  const patch: Record<string, unknown> = { agentId: correctAgentId };
                  if (resolvedAccountId && !accountId) {
                    patch.delivery = { accountId: resolvedAccountId };
                  }
                  await ctx.gatewayManager.rpc('cron.update', { id: job.id, patch });
                  // Update the local job object so response reflects correct agentId
                  (job as unknown as { agentId: string }).agentId = correctAgentId;
                  if (resolvedAccountId && !accountId && job.delivery) {
                    job.delivery.accountId = resolvedAccountId;
                  }
                } else {
                  console.warn(`Could not resolve agent for job "${job.name}": channel="${channel}", accountId="${accountId || '(none)'}", to="${toAddress || '(none)'}"`);
                }
              } catch (error) {
                console.error(`Failed to repair agent for job "${job.name}":`, error);
              }
            }
          })();
        }
      }

      sendJson(res, 200, jobs.map((job) => ({ ...transformCronJob(job), ...(usedFallback ? { _fromFallback: true } : {}) })));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{
        name: string;
        message: string;
        schedule: string;
        delivery?: GatewayCronDelivery;
        enabled?: boolean;
        agentId?: string;
      }>(req);
      const agentId = typeof input.agentId === 'string' && input.agentId.trim()
        ? input.agentId.trim()
        : 'main';
      // DEBUG: log the input and resolved agentId
      console.debug(`Creating cron job: name="${input.name}", input.agentId="${input.agentId || '(not provided)'}", resolved agentId="${agentId}"`);
      const delivery = normalizeCronDelivery(input.delivery);
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(delivery.channel);
      if (delivery.mode === 'announce' && unsupportedDeliveryError) {
        sendJson(res, 400, { success: false, error: unsupportedDeliveryError });
        return true;
      }
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        agentId,
        delivery,
      });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const input = await parseJsonBody<Record<string, unknown>>(req);
      const patch = buildCronUpdatePatch(input);
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
        sendJson(res, 400, { success: false, error: unsupportedDeliveryError });
        return true;
      }
      const result = await ctx.gatewayManager.rpc('cron.update', { id, patch });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.remove', { id }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/toggle' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string; enabled: boolean }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { id: body.id, patch: { enabled: body.enabled } }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/trigger' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.run', { id: body.id, mode: 'force' }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
