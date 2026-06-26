import { readdir, readFile, stat } from 'fs/promises';
import { app } from 'electron';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromCcConnectSessionStore,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
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
    const [, scope = 'main', user = 'main'] = sessionKey.split(':');
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
): void {
  if (!userSessions || typeof userSessions !== 'object' || Array.isArray(userSessions)) return;
  for (const [sessionKey, storeSessionIds] of Object.entries(userSessions)) {
    if (!Array.isArray(storeSessionIds)) continue;
    for (const storeSessionId of storeSessionIds) {
      if (typeof storeSessionId !== 'string') continue;
      if (!target.has(storeSessionId)) {
        target.set(storeSessionId, fromCcConnectBridgeSessionKey(sessionKey));
      }
    }
  }
}

function extractCodexSessionIdFromRolloutFileName(fileName: string): string | undefined {
  const transcriptId = extractSessionIdFromTranscriptFileName(fileName);
  const uuidMatch = transcriptId?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return uuidMatch?.[0] ?? transcriptId;
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

async function readCcConnectCodexSessionContexts(): Promise<Map<string, { sessionId: string; agentId: string }>> {
  const sessionsDir = join(app.getPath('userData'), 'runtimes', 'cc-connect', 'data', 'sessions');
  const contexts = new Map<string, { sessionId: string; agentId: string }>();

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
      addCcConnectUserSessionMappings(sessionKeyByStoreSessionId, record.user_sessions);

      for (const [storeSessionId, session] of Object.entries(sessions)) {
        if (!session || typeof session !== 'object' || Array.isArray(session)) continue;
        const sessionRecord = session as Record<string, unknown>;
        const codexSessionId = typeof sessionRecord.agent_session_id === 'string'
          ? sessionRecord.agent_session_id.trim()
          : '';
        if (!codexSessionId) continue;

        const sessionId = sessionKeyByStoreSessionId.get(storeSessionId)
          ?? String(sessionRecord.id || storeSessionId);
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
  sessionContexts: Map<string, { sessionId: string; agentId: string }>,
): Promise<RecentUsageSourceFile[]> {
  const sessionsRoot = join(app.getPath('userData'), 'runtimes', 'cc-connect', 'codex-home', 'sessions');
  const files: RecentUsageSourceFile[] = [];

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
      const context = sessionContexts.get(codexSessionId) ?? {
        sessionId: codexSessionId,
        agentId: 'main',
      };

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

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const ccConnectCodexSessionContexts = await readCcConnectCodexSessionContexts();
  const files = [
    ...await listRecentSessionFiles(),
    ...await listRecentCcConnectSessionStoreFiles(),
    ...await listRecentCcConnectCodexTranscriptFiles(ccConnectCodexSessionContexts),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const results: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const file of files) {
    if (results.length >= maxEntries) break;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const remaining = Number.isFinite(maxEntries) ? maxEntries - results.length : undefined;
      const entries = file.source === 'cc-connect-session-store'
        ? parseUsageEntriesFromCcConnectSessionStore(content, {
            sessionId: file.sessionId,
            agentId: file.agentId,
          }, remaining)
        : parseUsageEntriesFromJsonl(content, {
            sessionId: file.sessionId,
            agentId: file.agentId,
          }, remaining);
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
