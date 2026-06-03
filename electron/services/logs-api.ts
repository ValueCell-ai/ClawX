import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { isRecord } from './payload-utils';

type RecentPayload = {
  tailLines?: unknown;
};

type ReadFilePayload = RecentPayload & {
  path?: unknown;
};

type MemoryPayload = {
  count?: unknown;
};

function safePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const relativePath = relative(parentDir, childPath);
  return relativePath.length > 0
    && !relativePath.startsWith('..')
    && !relativePath.includes(`..${sep}`);
}

async function validateLogFilePath(path: unknown): Promise<string> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Invalid log file path');
  }

  const resolvedPath = resolve(path);
  const files = await logger.listLogFiles();
  if (files.some((file) => resolve(file.path) === resolvedPath)) {
    return resolvedPath;
  }

  const logDir = logger.getLogDir();
  if (!logDir) {
    throw new Error('Invalid log file path');
  }

  const resolvedLogDir = resolve(logDir);
  if (!isPathInside(resolvedLogDir, resolvedPath) || extname(resolvedPath) !== '.log') {
    throw new Error('Invalid log file path');
  }
  return resolvedPath;
}

async function readLogFileTail(path: string, tailLines: number): Promise<string> {
  const content = await readFile(path, 'utf8');
  const lines = content.split('\n');
  const hasTrailingNewline = lines.at(-1) === '';
  if (hasTrailingNewline) {
    lines.pop();
  }
  if (lines.length <= tailLines) return content;
  const tail = lines.slice(-tailLines).join('\n');
  return hasTrailingNewline ? `${tail}\n` : tail;
}

export function createLogsApi(): CompleteHostServiceRegistry['logs'] {
  return {
    recent: async (payload) => {
      const body = isRecord(payload) ? payload as RecentPayload : {};
      return { content: await logger.readLogFile(safePositiveInteger(body.tailLines, 100)) };
    },
    memory: (payload) => {
      const body = isRecord(payload) ? payload as MemoryPayload : {};
      return logger.getRecentLogs(
        body.count === undefined ? undefined : safePositiveInteger(body.count, 100),
      );
    },
    dir: () => ({ dir: logger.getLogDir() }),
    filePath: () => ({ path: logger.getLogFilePath() }),
    listFiles: async () => ({ files: await logger.listLogFiles() }),
    readFile: async (payload) => {
      const body = isRecord(payload) ? payload as ReadFilePayload : {};
      const path = await validateLogFilePath(body.path);
      return { content: await readLogFileTail(path, safePositiveInteger(body.tailLines, 200)) };
    },
  };
}
