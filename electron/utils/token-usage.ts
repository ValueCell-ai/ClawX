import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';
import type { RuntimeKind } from '@shared/types/gateway';
import { listConfiguredAgentIds } from './agent-config';

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

type RecentUsageSourceFile = {
  filePath: string;
  sessionId: string;
  agentId: string;
  mtimeMs: number;
  source: 'openclaw-jsonl';
};

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
  return runtimeKind === 'openclaw' && file.source === 'openclaw-jsonl';
}

export async function getRecentTokenUsageHistory(input?: number | TokenUsageHistoryOptions): Promise<TokenUsageHistoryEntry[]> {
  const options = normalizeTokenUsageOptions(input);
  if (options.runtimeKind === 'cc-connect') return [];
  const files = (await listRecentSessionFiles())
    .filter((file) => matchesRuntimeKind(file, options.runtimeKind))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const results: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(Math.floor(options.limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const file of files) {
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
        runtimeKind: 'openclaw',
      });
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}
