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
  source: 'openclaw-jsonl' | 'cc-connect-session-store';
};

function agentIdFromCcConnectProjectName(projectName: string): string {
  const normalized = projectName.replace(/_[a-f0-9]{8}\.json$/i, '').replace(/\.json$/i, '');
  if (!normalized.startsWith('clawx-')) return 'main';
  return normalized.slice('clawx-'.length) || 'main';
}

function ccConnectSessionStoreProjectName(fileName: string): string {
  return fileName.replace(/_[a-f0-9]{8}\.json$/i, '').replace(/\.json$/i, '');
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

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const files = [
    ...await listRecentSessionFiles(),
    ...await listRecentCcConnectSessionStoreFiles(),
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
