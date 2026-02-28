import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';

export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
}

interface TranscriptUsageShape {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
}

interface TranscriptLineShape {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    modelRef?: string;
    provider?: string;
    usage?: TranscriptUsageShape;
  };
}

export function parseUsageEntriesFromJsonl(
  content: string,
  context: { sessionId: string; agentId: string },
  limit = 20,
): TokenUsageHistoryEntry[] {
  const entries: TokenUsageHistoryEntry[] = [];
  const lines = content.split(/\r?\n/).filter(Boolean);

  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
    let parsed: TranscriptLineShape;
    try {
      parsed = JSON.parse(lines[i]) as TranscriptLineShape;
    } catch {
      continue;
    }

    const message = parsed.message;
    if (!message || message.role !== 'assistant' || !message.usage || !parsed.timestamp) {
      continue;
    }

    const usage = message.usage;
    const inputTokens = usage.input ?? usage.promptTokens ?? 0;
    const outputTokens = usage.output ?? usage.completionTokens ?? 0;
    const cacheReadTokens = usage.cacheRead ?? 0;
    const cacheWriteTokens = usage.cacheWrite ?? 0;
    const totalTokens = usage.total ?? usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    if (totalTokens <= 0 && !usage.cost?.total) {
      continue;
    }

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model: message.model ?? message.modelRef,
      provider: message.provider,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costUsd: usage.cost?.total,
    });
  }

  return entries;
}

async function listRecentSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const openclawDir = getOpenClawConfigDir();
  const agentsDir = join(openclawDir, 'agents');
  let agentEntries: string[] = [];

  try {
    agentEntries = await readdir(agentsDir);
  } catch {
    return [];
  }

  const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

  for (const agentId of agentEntries) {
    const sessionsDir = join(agentsDir, agentId, 'sessions');
    let sessionEntries: string[] = [];
    try {
      sessionEntries = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const fileName of sessionEntries) {
      if (!fileName.endsWith('.jsonl') || fileName.includes('.deleted.')) continue;
      const filePath = join(sessionsDir, fileName);
      try {
        const fileStat = await stat(filePath);
        files.push({
          filePath,
          sessionId: fileName.replace(/\.jsonl$/, ''),
          agentId,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

export async function getRecentTokenUsageHistory(limit = 20): Promise<TokenUsageHistoryEntry[]> {
  const files = await listRecentSessionFiles();
  const results: TokenUsageHistoryEntry[] = [];

  for (const file of files) {
    if (results.length >= limit) break;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }, limit - results.length);
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return results.slice(0, limit);
}
