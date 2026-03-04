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

function toErrorText(startupError: unknown): string {
  return startupError instanceof Error
    ? `${startupError.name}: ${startupError.message}`
    : String(startupError ?? '');
}

export function buildInvalidConfigRepairGuidance(
  startupError: unknown,
  startupStderrLines: string[],
): string {
  const combined = `${startupStderrLines.join('\n')}\n${toErrorText(startupError)}`.toLowerCase();
  const base =
    'Gateway startup blocked by invalid OpenClaw config. Automatic doctor repair failed. ' +
    'Please run: openclaw doctor --fix';

  if (combined.includes('dingtalk')) {
    return `${base}. If the error mentions dingtalk, remove stale "channels.dingtalk" and ` +
      `"plugins.allow" entries from ~/.openclaw/openclaw.json, then restart ClawX.`;
  }

  return base;
}

