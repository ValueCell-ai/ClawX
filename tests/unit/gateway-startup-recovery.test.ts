import { describe, expect, it } from 'vitest';
import {
  hasInvalidConfigFailureSignal,
  isInvalidConfigSignal,
  shouldAttemptConfigAutoRepair,
  isSystemdConflictSignal,
  hasSystemdConflictSignal,
  getGatewayStartupRecoveryAction,
} from '@electron/gateway/startup-recovery';

describe('gateway startup recovery heuristics', () => {
  it('detects invalid-config signal from stderr lines', () => {
    const lines = [
      'Invalid config at C:\\Users\\pc\\.openclaw\\openclaw.json:\\n- skills: Unrecognized key: "enabled"',
      'Run: openclaw doctor --fix',
    ];
    expect(hasInvalidConfigFailureSignal(new Error('gateway start failed'), lines)).toBe(true);
  });

  it('detects invalid-config signal from error message fallback', () => {
    expect(
      hasInvalidConfigFailureSignal(
        new Error('Config invalid. Run: openclaw doctor --fix'),
        [],
      ),
    ).toBe(true);
  });

  it('does not treat unrelated startup failures as invalid-config failures', () => {
    const lines = [
      'Gateway process exited (code=1, expected=no)',
      'WebSocket closed before handshake',
    ];
    expect(
      hasInvalidConfigFailureSignal(
        new Error('Gateway process exited before becoming ready (code=1)'),
        lines,
      ),
    ).toBe(false);
  });

  it('attempts auto-repair only once per startup flow', () => {
    const lines = ['Config invalid', '- skills: Unrecognized key: "enabled"'];
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, false)).toBe(true);
    expect(shouldAttemptConfigAutoRepair(new Error('start failed'), lines, true)).toBe(false);
  });

  it('matches common invalid-config phrases robustly', () => {
    expect(isInvalidConfigSignal('Config invalid')).toBe(true);
    expect(isInvalidConfigSignal('skills: Unrecognized key: "enabled"')).toBe(true);
    expect(isInvalidConfigSignal('Run: openclaw doctor --fix')).toBe(true);
    expect(isInvalidConfigSignal('Gateway ready after 3 attempts')).toBe(false);
  });

  describe('systemd conflict detection', () => {
    it('detects already-running-under-systemd signal', () => {
      expect(isSystemdConflictSignal('2026-03-27T13:08:36.125+11:00 [gateway] already running under systemd; waiting 5000ms before retrying startup')).toBe(true);
      expect(isSystemdConflictSignal('already running under systemd')).toBe(true);
      expect(isSystemdConflictSignal('ALREADY RUNNING UNDER SYSTEMD')).toBe(true);
    });

    it('does not false-positive on unrelated messages', () => {
      expect(isSystemdConflictSignal('Gateway process exited (code=1)')).toBe(false);
      expect(isSystemdConflictSignal('WebSocket closed before handshake')).toBe(false);
      expect(isSystemdConflictSignal('')).toBe(false);
    });

    it('hasSystemdConflictSignal returns true when any line matches', () => {
      const lines = [
        'Starting gateway...',
        '[gateway] already running under systemd; waiting 5000ms before retrying startup',
        'Retrying...',
      ];
      expect(hasSystemdConflictSignal(lines)).toBe(true);
    });

    it('hasSystemdConflictSignal returns false when no lines match', () => {
      const lines = ['Gateway ready', 'Listening on port 18789'];
      expect(hasSystemdConflictSignal(lines)).toBe(false);
    });

    it('getGatewayStartupRecoveryAction returns fail immediately on systemd conflict', () => {
      const stderrLines = [
        '[gateway] already running under systemd; waiting 5000ms before retrying startup',
      ];
      // Should fail even on the first attempt and even for an error that would
      // normally be classified as transient.
      const action = getGatewayStartupRecoveryAction({
        startupError: new Error('Gateway process exited before becoming ready (code=1)'),
        startupStderrLines: stderrLines,
        configRepairAttempted: false,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(action).toBe('fail');
    });

    it('getGatewayStartupRecoveryAction still retries transient errors without systemd signal', () => {
      const action = getGatewayStartupRecoveryAction({
        startupError: new Error('Gateway process exited before becoming ready (code=1)'),
        startupStderrLines: [],
        configRepairAttempted: false,
        attempt: 1,
        maxAttempts: 3,
      });
      expect(action).toBe('retry');
    });
  });
});

