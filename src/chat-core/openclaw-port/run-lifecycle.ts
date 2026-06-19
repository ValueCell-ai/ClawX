/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */

export const CHAT_RUN_STATUS_TOAST_DURATION_MS = 5_000;
export const STALE_ACTIVE_ROW_RECONCILE_WINDOW_MS = 10_000;

export type SessionRunStatus = 'running' | 'done' | 'killed' | 'error' | 'aborted';

export type GatewaySessionRow = {
  key: string;
  hasActiveRun?: boolean;
  status?: SessionRunStatus;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  abortedLastRun?: boolean;
};

export type SessionsListResult = {
  sessions: GatewaySessionRow[];
};

export type ChatRunUiStatus = {
  phase: 'done' | 'interrupted';
  runId: string | null;
  sessionKey: string;
  occurredAt: number;
};

export type LocalTerminalReconcile = {
  sessionKey: string;
  runId: string | null;
  phase: ChatRunUiStatus['phase'];
  sessionStatus: SessionRunStatus;
  occurredAt: number;
};

type RunLifecycleHost = {
  sessionKey: string;
  chatRunId?: string | null;
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  chatSideResultTerminalRuns?: Set<string>;
  chatRunStatus?: ChatRunUiStatus | null;
  sessionsResult?: SessionsListResult | null;
  lastLocalTerminalReconcile?: LocalTerminalReconcile | null;
  compactionStatus?: unknown | null;
  fallbackStatus?: unknown | null;
  toolStreamById?: Map<string, unknown>;
  toolStreamOrder?: unknown[];
  chatToolMessages?: unknown[];
  chatStreamSegments?: unknown[];
  requestUpdate?: () => void;
};

type ReconcileOptions = {
  outcome?: ChatRunUiStatus['phase'];
  sessionStatus?: SessionRunStatus;
  runId?: string | null;
  sessionKey?: string | null;
  sessionKeys?: readonly (string | null | undefined)[];
  clearLocalRun?: boolean;
  clearChatStream?: boolean;
  clearIndicators?: boolean;
  clearToolStream?: boolean;
  clearSideResultTerminalRuns?: boolean;
  clearRunStatus?: boolean;
  publishRunStatus?: boolean;
  armLocalTerminalReconcile?: boolean;
};

function toSessionKey(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function isSessionRunActive(row: GatewaySessionRow): boolean {
  return row.hasActiveRun === true || row.status === 'running';
}

function clearRunIndicators(host: RunLifecycleHost): void {
  host.compactionStatus = null;
  host.fallbackStatus = null;
}

function sessionKeysFor(host: RunLifecycleHost, options: ReconcileOptions): Set<string> {
  const keys = new Set<string>();
  const primary = toSessionKey(options.sessionKey) ?? host.sessionKey;
  if (primary) keys.add(primary);
  for (const key of options.sessionKeys ?? []) {
    const normalized = toSessionKey(key);
    if (normalized) keys.add(normalized);
  }
  return keys;
}

function resetToolStream(host: RunLifecycleHost): void {
  host.toolStreamById?.clear();
  if (Array.isArray(host.toolStreamOrder)) host.toolStreamOrder = [];
  if (Array.isArray(host.chatToolMessages)) host.chatToolMessages = [];
  if (Array.isArray(host.chatStreamSegments)) host.chatStreamSegments = [];
}

function reconcileSessionRows(
  host: RunLifecycleHost,
  options: ReconcileOptions,
  occurredAt: number,
): void {
  if (!options.outcome || !host.sessionsResult) return;
  const keys = sessionKeysFor(host, options);
  if (keys.size === 0) return;
  const status = options.sessionStatus ?? (options.outcome === 'done' ? 'done' : 'killed');
  let changed = false;
  const sessions = host.sessionsResult.sessions.map((row) => {
    if (!keys.has(row.key)) return row;
    const next: GatewaySessionRow = {
      ...row,
      hasActiveRun: false,
      status,
      endedAt: row.endedAt ?? occurredAt,
    };
    if (status === 'killed') next.abortedLastRun = true;
    if (typeof next.startedAt === 'number' && typeof next.endedAt === 'number') {
      next.runtimeMs = Math.max(0, next.endedAt - next.startedAt);
    }
    changed = true;
    return next;
  });
  if (changed) host.sessionsResult = { ...host.sessionsResult, sessions };
}

export function reconcileChatRunLifecycle(
  host: RunLifecycleHost,
  options: ReconcileOptions = {},
): void {
  const occurredAt = Date.now();
  const runId = options.runId ?? host.chatRunId ?? null;
  const sessionKey = toSessionKey(options.sessionKey) ?? host.sessionKey;

  if (options.clearIndicators ?? true) clearRunIndicators(host);
  if (options.clearChatStream) {
    host.chatStream = null;
    host.chatStreamStartedAt = null;
  }
  if (options.clearLocalRun) host.chatRunId = null;
  if (options.clearSideResultTerminalRuns) host.chatSideResultTerminalRuns?.clear();
  if (options.clearToolStream) resetToolStream(host);

  if (options.outcome) {
    const status: ChatRunUiStatus = { phase: options.outcome, runId, sessionKey, occurredAt };
    reconcileSessionRows(host, options, occurredAt);
    if (options.armLocalTerminalReconcile) {
      host.lastLocalTerminalReconcile = {
        sessionKey,
        runId,
        phase: options.outcome,
        sessionStatus: options.sessionStatus ?? (options.outcome === 'done' ? 'done' : 'killed'),
        occurredAt,
      };
    }
    if (options.publishRunStatus !== false) host.chatRunStatus = status;
  } else if (options.clearRunStatus) {
    host.chatRunStatus = null;
  }
  host.requestUpdate?.();
}

function currentSessionRow(host: RunLifecycleHost): GatewaySessionRow | undefined {
  return host.sessionsResult?.sessions.find((row) => row.key === host.sessionKey);
}

function reconcileStaleSelectedSessionRunAfterLocalCompletion(host: RunLifecycleHost): boolean {
  const recent = host.lastLocalTerminalReconcile;
  if (!recent || recent.sessionKey !== host.sessionKey) return false;
  if (Date.now() - recent.occurredAt > STALE_ACTIVE_ROW_RECONCILE_WINDOW_MS) {
    host.lastLocalTerminalReconcile = null;
    return false;
  }
  const row = currentSessionRow(host);
  if (!row || !isSessionRunActive(row)) {
    host.lastLocalTerminalReconcile = null;
    return false;
  }
  if (typeof row.startedAt === 'number' && row.startedAt > recent.occurredAt) {
    host.lastLocalTerminalReconcile = null;
    return false;
  }
  reconcileSessionRows(
    host,
    { outcome: recent.phase, sessionStatus: recent.sessionStatus, sessionKey: recent.sessionKey },
    Date.now(),
  );
  host.requestUpdate?.();
  return true;
}

export function reconcileChatRunFromCurrentSessionRow(
  host: RunLifecycleHost,
  options: { publishRunStatus?: boolean } = {},
): boolean {
  if (!host.chatRunId && host.chatStream == null) {
    return reconcileStaleSelectedSessionRunAfterLocalCompletion(host);
  }
  const row = currentSessionRow(host);
  if (!row) return false;
  return reconcileChatRunFromSessionRow(host, row, options);
}

export function reconcileChatRunFromSessionRow(
  host: RunLifecycleHost,
  row: GatewaySessionRow,
  options: { publishRunStatus?: boolean } = {},
): boolean {
  if (row.key !== host.sessionKey) return false;
  if (!host.chatRunId && host.chatStream == null) return false;
  if (isSessionRunActive(row)) return false;
  const terminalStatus = row.status !== undefined;
  if (row.hasActiveRun !== false && !terminalStatus) return false;

  reconcileChatRunLifecycle(host, {
    outcome: row.status === 'done' ? 'done' : 'interrupted',
    sessionStatus: row.status === 'done' ? 'done' : (row.status ?? 'killed'),
    runId: host.chatRunId,
    sessionKey: host.sessionKey,
    sessionKeys: [row.key],
    clearLocalRun: true,
    clearChatStream: true,
    publishRunStatus: options.publishRunStatus,
  });
  return true;
}
