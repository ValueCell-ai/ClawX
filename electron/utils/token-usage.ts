import { readdir, readFile, stat } from 'fs/promises';
import { app } from 'electron';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import { getCcConnectManagedDir } from '../runtime/cc-connect-paths';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromCcConnectSessionStore,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import type { RuntimeKind } from '@shared/types/gateway';
import { listConfiguredAgentIds } from './agent-config';

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromCcConnectSessionStore,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

type RecentUsageSourceFile = {
  filePath: string;
  sessionId: string;
  agentId: string;
  mtimeMs: number;
  source: 'openclaw-jsonl' | 'cc-connect-session-store' | 'cc-connect-codex-jsonl';
};

type CcConnectCodexSessionContext = {
  sessionId: string;
  agentId: string;
};

function agentIdFromCcConnectProjectName(projectName: string): string {
  const normalized = projectName.replace(/_[a-f0-9]{8}\.json$/i, '').replace(/\.json$/i, '');
  if (!normalized.startsWith('clawx-')) return 'main';
  return normalized.slice('clawx-'.length) || 'main';
}

function ccConnectSessionStoreProjectName(fileName: string): string {
  return fileName.replace(/_[a-f0-9]{8}\.json$/i, '').replace(/\.json$/i, '');
}

function fromCcConnectBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) {
    const [, scope = 'main', ...userParts] = sessionKey.split(':');
    const user = userParts.join(':') || 'main';
    return `agent:${scope || 'main'}:${user || 'main'}`;
  }
  return sessionKey;
}

function agentIdFromSessionId(sessionId: string, fallbackAgentId: string): string {
  if (!sessionId.startsWith('agent:')) return fallbackAgentId;
  return sessionId.split(':')[1] || fallbackAgentId;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    typeof item === 'string' ? [[key, item]] : []
  )));
}

function addCcConnectSessionKeyMappings(
  target: Map<string, string>,
  sessionKeyMap: unknown,
): void {
  for (const [sessionKey, storeSessionId] of Object.entries(readStringMap(sessionKeyMap))) {
    if (!target.has(storeSessionId)) {
      target.set(storeSessionId, fromCcConnectBridgeSessionKey(sessionKey));
    }
  }
}

function addCcConnectUserSessionMappings(
  target: Map<string, string>,
  userSessions: unknown,
  fallbackAgentId: string,
  activeSession?: unknown,
): void {
  if (!userSessions || typeof userSessions !== 'object' || Array.isArray(userSessions)) return;
  const activeSessions = readStringMap(activeSession);
  for (const [sessionKey, storeSessionIds] of Object.entries(userSessions)) {
    if (!Array.isArray(storeSessionIds)) continue;
    const normalizedSessionKey = fromCcConnectBridgeSessionKey(sessionKey);
    const isAgentSessionKey = normalizedSessionKey.startsWith('agent:');
    for (const storeSessionId of storeSessionIds) {
      if (typeof storeSessionId !== 'string') continue;
      if (!target.has(storeSessionId)) {
        target.set(
          storeSessionId,
          !isAgentSessionKey || activeSessions[sessionKey] === storeSessionId
            ? normalizedSessionKey
            : `agent:${fallbackAgentId || 'main'}:${storeSessionId}`,
        );
      }
    }
  }
}

function extractCodexSessionIdFromRolloutFileName(fileName: string): string | undefined {
  const transcriptId = extractSessionIdFromTranscriptFileName(fileName);
  const uuidMatch = transcriptId?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return uuidMatch?.[0] ?? transcriptId;
}

function normalizeLocalPath(path: string): string {
  return path.replace(/^\/private\/tmp\//, '/tmp/').replace(/\/+$/, '');
}

function parseTomlString(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match?.[1];
}

async function readCcConnectWorkspaceContexts(): Promise<Map<string, CcConnectCodexSessionContext>> {
  const contexts = new Map<string, CcConnectCodexSessionContext>();
  const managedDir = getCcConnectManagedDir();

  try {
    const config = await readFile(join(managedDir, 'config.toml'), 'utf8');
    for (const block of config.split(/\[\[projects\]\]/g).slice(1)) {
      const projectName = parseTomlString(block, 'name') ?? '';
      const workDir = parseTomlString(block, 'work_dir') ?? '';
      if (!projectName.startsWith('clawx-') || !workDir) continue;
      const agentId = projectName.slice('clawx-'.length) || 'main';
      contexts.set(normalizeLocalPath(workDir), {
        agentId,
        sessionId: `agent:${agentId}:main`,
      });
    }
  } catch {
    // Runtime config may not exist yet; fall back to the default managed layout.
  }

  const defaultMainWorkspace = normalizeLocalPath(join(managedDir, 'workspaces', 'main'));
  if (!contexts.has(defaultMainWorkspace)) {
    contexts.set(defaultMainWorkspace, { agentId: 'main', sessionId: 'agent:main:main' });
  }

  return contexts;
}

function contextFromManagedWorkspace(
  cwd: string,
  workspaceContexts: Map<string, CcConnectCodexSessionContext>,
): CcConnectCodexSessionContext | undefined {
  const normalizedCwd = normalizeLocalPath(cwd);
  const direct = workspaceContexts.get(normalizedCwd);
  if (direct) return direct;

  const managedWorkspacesDir = normalizeLocalPath(join(getCcConnectManagedDir(), 'workspaces'));
  if (!normalizedCwd.startsWith(`${managedWorkspacesDir}/`)) return undefined;
  const agentId = normalizedCwd.slice(managedWorkspacesDir.length + 1).split('/')[0] || 'main';
  return { agentId, sessionId: `agent:${agentId}:main` };
}

async function readCcConnectCodexTranscriptFallbackContext(
  filePath: string,
  workspaceContexts: Map<string, CcConnectCodexSessionContext>,
): Promise<CcConnectCodexSessionContext | undefined> {
  try {
    for (const line of (await readFile(filePath, 'utf8')).split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (record.type !== 'session_meta') continue;
      const payload = record.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
      const cwd = (payload as Record<string, unknown>).cwd;
      return typeof cwd === 'string'
        ? contextFromManagedWorkspace(cwd, workspaceContexts)
        : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function listAgentIdsWithSessionDirs(): Promise<string[]> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');
  const agentIds = new Set<string>();

  try {
    for (const agentId of await listConfiguredAgentIds()) {
      const normalized = agentId.trim();
      if (normalized) {
        agentIds.add(normalized);
      }
    }
  } catch {
    // Ignore config discovery failures and fall back to disk scan.
  }

  try {
    const agentEntries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isDirectory()) {
        const normalized = entry.name.trim();
        if (normalized) {
          agentIds.add(normalized);
        }
      }
    }
  } catch {
    // Ignore disk discovery failures and return whatever we already found.
  }

  return [...agentIds];
}

async function listRecentSessionFiles(): Promise<RecentUsageSourceFile[]> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');

  try {
    const agentEntries = await listAgentIdsWithSessionDirs();
    const files: RecentUsageSourceFile[] = [];

    for (const agentId of agentEntries) {
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      try {
        const sessionEntries = await readdir(sessionsDir);

        for (const fileName of sessionEntries) {
          const sessionId = extractSessionIdFromTranscriptFileName(fileName);
          if (!sessionId) continue;
          const filePath = join(sessionsDir, fileName);
          try {
            const fileStat = await stat(filePath);
            files.push({
              filePath,
              sessionId,
              agentId,
              mtimeMs: fileStat.mtimeMs,
              source: 'openclaw-jsonl',
            });
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
  } catch {
    return [];
  }
}

async function listRecentCcConnectSessionStoreFiles(): Promise<RecentUsageSourceFile[]> {
  const sessionsDir = join(app.getPath('userData'), 'runtimes', 'cc-connect', 'data', 'sessions');
  const files: RecentUsageSourceFile[] = [];
  try {
    for (const fileName of await readdir(sessionsDir)) {
      if (!fileName.endsWith('.json')) continue;
      const filePath = join(sessionsDir, fileName);
      try {
        const fileStat = await stat(filePath);
        const projectName = ccConnectSessionStoreProjectName(fileName);
        files.push({
          filePath,
          sessionId: projectName,
          agentId: agentIdFromCcConnectProjectName(projectName),
          mtimeMs: fileStat.mtimeMs,
          source: 'cc-connect-session-store',
        });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function readCcConnectCodexSessionContexts(): Promise<Map<string, CcConnectCodexSessionContext>> {
  const sessionsDir = join(app.getPath('userData'), 'runtimes', 'cc-connect', 'data', 'sessions');
  const contexts = new Map<string, CcConnectCodexSessionContext>();

  try {
    for (const fileName of await readdir(sessionsDir)) {
      if (!fileName.endsWith('.json')) continue;
      if (fileName.startsWith('.')) continue;

      const projectName = ccConnectSessionStoreProjectName(fileName);
      const fallbackAgentId = agentIdFromCcConnectProjectName(projectName);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(join(sessionsDir, fileName), 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      const record = parsed as Record<string, unknown>;
      const sessions = record.sessions;
      if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) continue;

      const sessionKeyByStoreSessionId = new Map<string, string>();
      addCcConnectSessionKeyMappings(sessionKeyByStoreSessionId, record.active_session);
      addCcConnectUserSessionMappings(sessionKeyByStoreSessionId, record.user_sessions, fallbackAgentId, record.active_session);

      for (const [storeSessionId, session] of Object.entries(sessions)) {
        if (!session || typeof session !== 'object' || Array.isArray(session)) continue;
        const sessionRecord = session as Record<string, unknown>;
        const codexSessionId = typeof sessionRecord.agent_session_id === 'string'
          ? sessionRecord.agent_session_id.trim()
          : '';
        if (!codexSessionId) continue;

        const sessionId = sessionKeyByStoreSessionId.get(storeSessionId)
          ?? `agent:${fallbackAgentId || 'main'}:${String(sessionRecord.id || storeSessionId)}`;
        contexts.set(codexSessionId, {
          sessionId,
          agentId: agentIdFromSessionId(sessionId, fallbackAgentId),
        });
      }
    }
  } catch {
    return contexts;
  }

  return contexts;
}

async function listRecentCcConnectCodexTranscriptFiles(
  sessionContexts: Map<string, CcConnectCodexSessionContext>,
): Promise<RecentUsageSourceFile[]> {
  const sessionsRoot = join(app.getPath('userData'), 'runtimes', 'cc-connect', 'codex-home', 'sessions');
  const files: RecentUsageSourceFile[] = [];
  const workspaceContexts = await readCcConnectWorkspaceContexts();

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      const codexSessionId = extractCodexSessionIdFromRolloutFileName(entry.name);
      if (!codexSessionId) continue;
      const context = sessionContexts.get(codexSessionId)
        ?? await readCcConnectCodexTranscriptFallbackContext(fullPath, workspaceContexts);
      if (!context) continue;

      try {
        const fileStat = await stat(fullPath);
        files.push({
          filePath: fullPath,
          sessionId: context.sessionId,
          agentId: context.agentId,
          mtimeMs: fileStat.mtimeMs,
          source: 'cc-connect-codex-jsonl',
        });
      } catch {
        continue;
      }
    }
  }

  await visit(sessionsRoot);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

export type TokenUsageHistoryOptions = {
  limit?: number;
  runtimeKind?: RuntimeKind;
};

function normalizeTokenUsageOptions(input?: number | TokenUsageHistoryOptions): TokenUsageHistoryOptions {
  if (typeof input === 'number') return { limit: input };
  return input ?? {};
}

function matchesRuntimeKind(file: RecentUsageSourceFile, runtimeKind?: RuntimeKind): boolean {
  if (!runtimeKind) return true;
  if (runtimeKind === 'openclaw') return file.source === 'openclaw-jsonl';
  return file.source === 'cc-connect-session-store' || file.source === 'cc-connect-codex-jsonl';
}

export async function getRecentTokenUsageHistory(input?: number | TokenUsageHistoryOptions): Promise<TokenUsageHistoryEntry[]> {
  const options = normalizeTokenUsageOptions(input);
  const ccConnectCodexSessionContexts = await readCcConnectCodexSessionContexts();
  const files = [
    ...await listRecentSessionFiles(),
    ...await listRecentCcConnectSessionStoreFiles(),
    ...await listRecentCcConnectCodexTranscriptFiles(ccConnectCodexSessionContexts),
  ]
    .filter((file) => matchesRuntimeKind(file, options.runtimeKind))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const results: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(Math.floor(options.limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const file of files) {
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = file.source === 'cc-connect-session-store'
        ? parseUsageEntriesFromCcConnectSessionStore(content, {
            sessionId: file.sessionId,
            agentId: file.agentId,
            runtimeKind: 'cc-connect',
          })
        : parseUsageEntriesFromJsonl(content, {
            sessionId: file.sessionId,
            agentId: file.agentId,
            runtimeKind: file.source === 'openclaw-jsonl' ? 'openclaw' : 'cc-connect',
          });
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
