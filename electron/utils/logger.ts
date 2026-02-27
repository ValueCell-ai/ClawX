/**
 * Logger Utility
 * Centralized logging with levels, file output, and log retrieval for UI.
 *
 * File writes use an async buffered writer so that high-frequency logging
 * (e.g. during gateway startup) never blocks the Electron main thread.
 * Only the final `process.on('exit')` handler uses synchronous I/O to
 * guarantee the last few messages are flushed before the process exits.
 */
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { appendFile, readFile, readdir, stat } from 'fs/promises';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Current log level (can be changed at runtime)
 */
// Default to INFO in packaged builds to reduce sync-like overhead from
// high-volume DEBUG logging.  In dev mode, keep DEBUG for diagnostics.
// Note: app.isPackaged may not be available before app.isReady(), but the
// logger is initialised after that point so this is safe.
let currentLevel = LogLevel.DEBUG;

/**
 * Log file path
 */
let logFilePath: string | null = null;
let logDir: string | null = null;

/**
 * In-memory ring buffer for recent logs (useful for UI display)
 */
const RING_BUFFER_SIZE = 500;
const recentLogs: string[] = [];

// ── Async write buffer ───────────────────────────────────────────

/** Pending log lines waiting to be flushed to disk. */
let writeBuffer: string[] = [];
/** Timer for the next scheduled flush. */
let flushTimer: NodeJS.Timeout | null = null;
/** Whether a flush is currently in progress. */
let flushing = false;

const FLUSH_INTERVAL_MS = 500;
const FLUSH_SIZE_THRESHOLD = 20;

async function flushBuffer(): Promise<void> {
  if (flushing || writeBuffer.length === 0 || !logFilePath) return;
  flushing = true;
  const batch = writeBuffer.join('');
  writeBuffer = [];
  try {
    await appendFile(logFilePath, batch);
  } catch {
    // Silently fail if we can't write to file
  } finally {
    flushing = false;
  }
}

/** Synchronous flush for the `exit` handler — guaranteed to write. */
function flushBufferSync(): void {
  if (writeBuffer.length === 0 || !logFilePath) return;
  try {
    appendFileSync(logFilePath, writeBuffer.join(''));
  } catch {
    // Silently fail
  }
  writeBuffer = [];
}

// Ensure all buffered data reaches disk before the process exits.
process.on('exit', flushBufferSync);

// ── Initialisation ───────────────────────────────────────────────

/**
 * Initialize logger — safe to call before app.isReady()
 */
export function initLogger(): void {
  try {
    // In production, default to INFO to reduce log volume and overhead.
    if (app.isPackaged && currentLevel < LogLevel.INFO) {
      currentLevel = LogLevel.INFO;
    }

    logDir = join(app.getPath('userData'), 'logs');

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    logFilePath = join(logDir, `clawx-${timestamp}.log`);

    // Write a separator for new session (sync is OK — happens once at startup)
    const sessionHeader = `\n${'='.repeat(80)}\n[${new Date().toISOString()}] === ClawX Session Start (v${app.getVersion()}) ===\n${'='.repeat(80)}\n`;
    appendFileSync(logFilePath, sessionHeader);
  } catch (error) {
    console.error('Failed to initialize logger:', error);
  }
}

// ── Level / path accessors ───────────────────────────────────────

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogDir(): string | null {
  return logDir;
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

// ── Formatting ───────────────────────────────────────────────────

function formatMessage(level: string, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.length > 0 ? ' ' + args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.message}\n${arg.stack || ''}`;
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ') : '';

  return `[${timestamp}] [${level.padEnd(5)}] ${message}${formattedArgs}`;
}

// ── Core write ───────────────────────────────────────────────────

/**
 * Write to ring buffer + schedule an async flush to disk.
 */
function writeLog(formatted: string): void {
  // Ring buffer (always synchronous — in-memory only)
  recentLogs.push(formatted);
  if (recentLogs.length > RING_BUFFER_SIZE) {
    recentLogs.shift();
  }

  // Async file write via buffer
  if (logFilePath) {
    writeBuffer.push(formatted + '\n');
    if (writeBuffer.length >= FLUSH_SIZE_THRESHOLD) {
      // Buffer is large enough — flush immediately (non-blocking)
      void flushBuffer();
    } else if (!flushTimer) {
      // Schedule a flush after a short delay
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushBuffer();
      }, FLUSH_INTERVAL_MS);
    }
  }
}

// ── Public log methods ───────────────────────────────────────────

export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    const formatted = formatMessage('DEBUG', message, ...args);
    console.debug(formatted);
    writeLog(formatted);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    const formatted = formatMessage('INFO', message, ...args);
    console.info(formatted);
    writeLog(formatted);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    const formatted = formatMessage('WARN', message, ...args);
    console.warn(formatted);
    writeLog(formatted);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    const formatted = formatMessage('ERROR', message, ...args);
    console.error(formatted);
    writeLog(formatted);
  }
}

// ── Log retrieval (for UI / diagnostics) ─────────────────────────

export function getRecentLogs(count?: number, minLevel?: LogLevel): string[] {
  const filtered = minLevel != null
    ? recentLogs.filter(line => {
      if (minLevel <= LogLevel.DEBUG) return true;
      if (minLevel === LogLevel.INFO) return !line.includes('] [DEBUG');
      if (minLevel === LogLevel.WARN) return line.includes('] [WARN') || line.includes('] [ERROR');
      return line.includes('] [ERROR');
    })
    : recentLogs;

  return count ? filtered.slice(-count) : [...filtered];
}

/**
 * Read the current day's log file content (last N lines).
 * Uses async I/O to avoid blocking.
 */
export async function readLogFile(tailLines = 200): Promise<string> {
  if (!logFilePath) return '(No log file found)';
  try {
    const content = await readFile(logFilePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= tailLines) return content;
    return lines.slice(-tailLines).join('\n');
  } catch (err) {
    return `(Failed to read log file: ${err})`;
  }
}

/**
 * List available log files.
 * Uses async I/O to avoid blocking.
 */
export async function listLogFiles(): Promise<Array<{ name: string; path: string; size: number; modified: string }>> {
  if (!logDir) return [];
  try {
    const files = await readdir(logDir);
    const results: Array<{ name: string; path: string; size: number; modified: string }> = [];
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const fullPath = join(logDir, f);
      const s = await stat(fullPath);
      results.push({
        name: f,
        path: fullPath,
        size: s.size,
        modified: s.mtime.toISOString(),
      });
    }
    return results.sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

/**
 * Logger namespace export
 */
export const logger = {
  debug,
  info,
  warn,
  error,
  setLevel: setLogLevel,
  init: initLogger,
  getLogDir,
  getLogFilePath,
  getRecentLogs,
  readLogFile,
  listLogFiles,
};
