import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import { listConfiguredAgentIds } from './agent-config';
import { readSqliteTranscriptRecordsForAgent } from './openclaw-transcript-sqlite';

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

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

async function listRecentSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');

  try {
    const agentEntries = await listAgentIdsWithSessionDirs();
    const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

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

async function readSqliteUsageHistory(agentIds: string[], remaining?: number): Promise<{ entries: TokenUsageHistoryEntry[]; agents: Set<string> }> {
  const entries: TokenUsageHistoryEntry[] = [];
  const agents = new Set<string>();
  for (const agentId of agentIds) {
    const dbPath = join(getOpenClawConfigDir(), 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
    try {
      const fsP = await import('node:fs/promises');
      await fsP.access(dbPath);
      const { DatabaseSync } = await import(/* @vite-ignore */ 'node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      agents.add(agentId);
      try {
        const keys = db.prepare('SELECT session_key FROM session_nodes').all() as Array<{ session_key?: unknown }>;
        for (const row of keys) {
          if (typeof row.session_key !== 'string') continue;
          const records = await readSqliteTranscriptRecordsForAgent(agentId, row.session_key);
          if (!records) continue;
          const content = records.map(record => JSON.stringify({ type: record.type, timestamp: record.timestamp, message: record.message })).join('\n');
          entries.push(...parseUsageEntriesFromJsonl(content, {
            sessionId: records.find(record => record.sessionId)?.sessionId || row.session_key,
            agentId,
          }, remaining));
          if (remaining !== undefined && entries.length >= remaining) return { entries: entries.slice(0, remaining), agents };
        }
      } finally { db.close(); }
    } catch (error) { logger.debug(`Failed to read token usage SQLite for ${agentId}:`, error); }
  }
  return { entries, agents };
}

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;
  const agentIds = await listAgentIdsWithSessionDirs();
  const sqliteHistory = await readSqliteUsageHistory(agentIds, Number.isFinite(maxEntries) ? maxEntries : undefined);
  const files = await listRecentSessionFiles();
  const results: TokenUsageHistoryEntry[] = [...sqliteHistory.entries];

  for (const file of files) {
    if (sqliteHistory.agents.has(file.agentId) || results.length >= maxEntries) continue;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }, Number.isFinite(maxEntries) ? maxEntries - results.length : undefined);
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
