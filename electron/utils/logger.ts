/**
 * Logger Utility
 * Centralized logging with levels, file output, and log retrieval for UI
 */
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, statSync } from 'fs';

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
let currentLevel = LogLevel.DEBUG; // Default to DEBUG for better diagnostics

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

/**
 * Initialize logger — safe to call before app.isReady()
 */
export function initLogger(): void {
  try {
    logDir = join(app.getPath('userData'), 'logs');

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    logFilePath = join(logDir, `clawx-${timestamp}.log`);

    // Write a separator for new session
    const sessionHeader = `\n${'='.repeat(80)}\n[${new Date().toISOString()}] === ClawX Session Start (v${app.getVersion()}) ===\n${'='.repeat(80)}\n`;
    appendFileSync(logFilePath, sessionHeader);
  } catch (error) {
    console.error('Failed to initialize logger:', error);
  }
}

/**
 * Set log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get log file directory path
 */
export function getLogDir(): string | null {
  return logDir;
}

/**
 * Get current log file path
 */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/**
 * Format log message
 */
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

/**
 * Write to log file and ring buffer
 */
function writeLog(formatted: string): void {
  // Ring buffer
  recentLogs.push(formatted);
  if (recentLogs.length > RING_BUFFER_SIZE) {
    recentLogs.shift();
  }

  // File
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, formatted + '\n');
    } catch {
      // Silently fail if we can't write to file
    }
  }
}

/**
 * Log debug message
 */
export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    const formatted = formatMessage('DEBUG', message, ...args);
    console.debug(formatted);
    writeLog(formatted);
  }
}

/**
 * Log info message
 */
export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    const formatted = formatMessage('INFO', message, ...args);
    console.info(formatted);
    writeLog(formatted);
  }
}

/**
 * Log warning message
 */
export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    const formatted = formatMessage('WARN', message, ...args);
    console.warn(formatted);
    writeLog(formatted);
  }
}

/**
 * Log error message
 */
export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    const formatted = formatMessage('ERROR', message, ...args);
    console.error(formatted);
    writeLog(formatted);
  }
}

/**
 * Get recent logs from ring buffer (for UI display)
 * @param count Number of recent log lines to return (default: all)
 * @param minLevel Minimum log level to include (default: DEBUG)
 */
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
 * Read the current day's log file content (last N lines)
 */
export function readLogFile(tailLines = 200): string {
  if (!logFilePath || !existsSync(logFilePath)) {
    return '(No log file found)';
  }
  try {
    const content = readFileSync(logFilePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= tailLines) return content;
    return lines.slice(-tailLines).join('\n');
  } catch (err) {
    return `(Failed to read log file: ${err})`;
  }
}

/**
 * List available log files
 */
export function listLogFiles(): Array<{ name: string; path: string; size: number; modified: string }> {
  if (!logDir || !existsSync(logDir)) return [];
  try {
    return readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const fullPath = join(logDir!, f);
        const stat = statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
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
