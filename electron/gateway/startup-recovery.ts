/**
 * Gateway startup recovery heuristics.
 *
 * This module is intentionally dependency-free so it can be unit-tested
 * without Electron/runtime mocks.
 */

const INVALID_CONFIG_PATTERNS: RegExp[] = [
  /\binvalid config\b/i,
  /\bconfig invalid\b/i,
  /\bfatal configuration error\b/i,
  /\bunrecognized key\b/i,
  /\bstartup migration(?:s)?\b.*\b(?:blocked|failed|did not complete cleanly)\b/i,
  /\bmigration\b.*\bopenclaw doctor --fix\b/i,
  /\brun:\s*openclaw doctor --fix\b/i,
];

const FATAL_RUNTIME_PATTERNS: RegExp[] = [
  /\bNode(?:\.js)?\b.*\boutside the supported range\b/i,
  /\buses SQLite\b.*\bnot WAL-reset-safe\b/i,
  /\bSQLite\b.*\bWAL-reset-safe runtime required\b/i,
  /\bInstall Node 24\.15\+.*\bNode 22\.22\.3\+\b/i,
];

const STARTUP_MIGRATION_LOCK_PATTERNS: RegExp[] = [
  /\bstartup migrations? (?:is|are) already running\b/i,
  /\bretry after the other gateway finishes\b/i,
];

const TRANSIENT_START_ERROR_PATTERNS: RegExp[] = [
  /WebSocket closed before handshake/i,
  /ECONNREFUSED/i,
  /Gateway process exited before becoming ready/i,
  /Timed out waiting for connect\.challenge/i,
  /Connect handshake timeout/i,
  // OpenClaw can emit connect.challenge before the connect RPC is accepted.
  /gateway starting/i,
  // Port occupied after orphan kill: transient, worth retrying with backoff
  /Port \d+ still occupied after \d+ms/i,
];

/** Backoff between connect() attempts when the Gateway rejects with "still starting". */
export const GATEWAY_CONNECT_STARTUP_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000] as const;

function normalizeLogLine(value: string): string {
  return value.trim();
}

/**
 * Returns true when text appears to indicate OpenClaw config validation failure.
 */
export function isInvalidConfigSignal(text: string): boolean {
  const normalized = normalizeLogLine(text);
  if (!normalized) return false;
  return INVALID_CONFIG_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true when either startup stderr lines or startup error message
 * indicate an OpenClaw config validation failure.
 */
export function hasInvalidConfigFailureSignal(
  startupError: unknown,
  startupStderrLines: string[],
): boolean {
  for (const line of startupStderrLines) {
    if (isInvalidConfigSignal(line)) {
      return true;
    }
  }

  const errorText = startupError instanceof Error
    ? `${startupError.name}: ${startupError.message}`
    : String(startupError ?? '');

  return isInvalidConfigSignal(errorText);
}

function startupFailureCandidates(startupError: unknown, startupStderrLines: string[]): string[] {
  return [
    ...startupStderrLines,
    startupError instanceof Error
      ? `${startupError.name}: ${startupError.message}`
      : String(startupError ?? ''),
  ];
}

/** Returns true for OpenClaw runtime/SQLite failures that doctor cannot repair. */
export function hasFatalRuntimeFailureSignal(
  startupError: unknown,
  startupStderrLines: string[],
): boolean {
  return startupFailureCandidates(startupError, startupStderrLines)
    .some((text) => FATAL_RUNTIME_PATTERNS.some((pattern) => pattern.test(text)));
}

/** Returns true while another/stale OpenClaw startup migration lease is active. */
export function hasStartupMigrationLockSignal(
  startupError: unknown,
  startupStderrLines: string[],
): boolean {
  return startupFailureCandidates(startupError, startupStderrLines)
    .some((text) => STARTUP_MIGRATION_LOCK_PATTERNS.some((pattern) => pattern.test(text)));
}

/**
 * Retry guard for one-time config repair during a single startup flow.
 */
export function shouldAttemptConfigAutoRepair(
  startupError: unknown,
  startupStderrLines: string[],
  alreadyAttempted: boolean,
): boolean {
  if (alreadyAttempted) return false;
  return hasInvalidConfigFailureSignal(startupError, startupStderrLines);
}

export function isTransientGatewayStartError(error: unknown): boolean {
  const errorText = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error ?? '');
  return TRANSIENT_START_ERROR_PATTERNS.some((pattern) => pattern.test(errorText));
}

export function isGatewayStillStartingError(error: unknown): boolean {
  const errorText = error instanceof Error
    ? error.message
    : String(error ?? '');
  return /gateway starting/i.test(errorText);
}

export async function connectGatewayWithStartupRetry(options: {
  connect: (port: number, externalToken?: string) => Promise<void>;
  port: number;
  externalToken?: string;
  delay: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  beforeAttempt?: () => void;
  logWarn?: (message: string) => void;
  logInfo?: (message: string) => void;
}): Promise<void> {
  const retryDelaysMs = options.retryDelaysMs ?? GATEWAY_CONNECT_STARTUP_RETRY_DELAYS_MS;
  const logWarn = options.logWarn ?? (() => {});
  const logInfo = options.logInfo ?? (() => {});
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    options.beforeAttempt?.();
    try {
      await options.connect(options.port, options.externalToken);
      if (attempt > 0) {
        logInfo(`Gateway connect succeeded after ${attempt + 1} attempt(s)`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (!isGatewayStillStartingError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      const delayMs = retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1]!;
      logWarn(
        `Gateway connect rejected while still starting (${String(error)}); `
        + `retrying in ${delayMs}ms (${attempt + 1}/${retryDelaysMs.length})`,
      );
      await options.delay(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Gateway connect failed'));
}

export type GatewayStartupRecoveryAction = 'repair' | 'retry' | 'fail';

export function getGatewayStartupRecoveryAction(options: {
  startupError: unknown;
  startupStderrLines: string[];
  configRepairAttempted: boolean;
  attempt: number;
  maxAttempts: number;
}): GatewayStartupRecoveryAction {
  if (
    hasFatalRuntimeFailureSignal(options.startupError, options.startupStderrLines)
    || hasStartupMigrationLockSignal(options.startupError, options.startupStderrLines)
  ) {
    return 'fail';
  }

  if (hasInvalidConfigFailureSignal(options.startupError, options.startupStderrLines)) {
    // One doctor pass is the only automated repair. If the same migration or
    // config failure remains afterward, stop instead of treating the generic
    // process-exited error as transient.
    return options.configRepairAttempted ? 'fail' : 'repair';
  }

  if (options.attempt < options.maxAttempts && isTransientGatewayStartError(options.startupError)) {
    return 'retry';
  }

  return 'fail';
}

