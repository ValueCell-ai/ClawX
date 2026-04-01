/**
 * Gateway startup recovery heuristics.
 *
 * This module is intentionally dependency-free so it can be unit-tested
 * without Electron/runtime mocks.
 */

const INVALID_CONFIG_PATTERNS: RegExp[] = [
  /\binvalid config\b/i,
  /\bconfig invalid\b/i,
  /\bunrecognized key\b/i,
  /\brun:\s*openclaw doctor --fix\b/i,
];

const TRANSIENT_START_ERROR_PATTERNS: RegExp[] = [
  /WebSocket closed before handshake/i,
  /ECONNREFUSED/i,
  /Gateway process exited before becoming ready/i,
  /Timed out waiting for connect\.challenge/i,
  /Connect handshake timeout/i,
  // Port occupied after orphan kill: transient, worth retrying with backoff
  /Port \d+ still occupied after \d+ms/i,
];

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

export type GatewayStartupRecoveryAction = 'repair' | 'retry' | 'fail';

export function getGatewayStartupRecoveryAction(options: {
  startupError: unknown;
  startupStderrLines: string[];
  configRepairAttempted: boolean;
  attempt: number;
  maxAttempts: number;
}): GatewayStartupRecoveryAction {
  if (shouldAttemptConfigAutoRepair(
    options.startupError,
    options.startupStderrLines,
    options.configRepairAttempted,
  )) {
    return 'repair';
  }

  if (options.attempt < options.maxAttempts && isTransientGatewayStartError(options.startupError)) {
    return 'retry';
  }

  return 'fail';
}

