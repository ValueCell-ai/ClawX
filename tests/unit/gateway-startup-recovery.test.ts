import { describe, expect, it } from 'vitest';
import {
  getGatewayStartupRecoveryAction,
  hasInvalidConfigFailureSignal,
  isInvalidConfigSignal,
  shouldAttemptConfigAutoRepair,
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
});

describe('getGatewayStartupRecoveryAction', () => {
  const configInvalidStderr = ['Config invalid', 'Run: openclaw doctor --fix'];
  const transientError = new Error('Gateway process exited before becoming ready (code=1)');

  it('returns repair on first config-invalid failure', () => {
    const action = getGatewayStartupRecoveryAction({
      startupError: transientError,
      startupStderrLines: configInvalidStderr,
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(action).toBe('repair');
  });

  it('returns retry when repair was attempted but error is still transient', () => {
    const action = getGatewayStartupRecoveryAction({
      startupError: transientError,
      startupStderrLines: configInvalidStderr,
      configRepairAttempted: true,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(action).toBe('retry');
  });

  it('returns retry for transient errors after successful repair (no config signal)', () => {
    const action = getGatewayStartupRecoveryAction({
      startupError: transientError,
      startupStderrLines: ['Gateway process exited (code=1, expected=no)'],
      configRepairAttempted: true,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(action).toBe('retry');
  });

  it('returns fail when max attempts exceeded even for transient errors', () => {
    const action = getGatewayStartupRecoveryAction({
      startupError: transientError,
      startupStderrLines: [],
      configRepairAttempted: false,
      attempt: 3,
      maxAttempts: 3,
    });
    expect(action).toBe('fail');
  });

  it('returns fail for non-transient, non-config errors', () => {
    const action = getGatewayStartupRecoveryAction({
      startupError: new Error('Unknown fatal error'),
      startupStderrLines: [],
      configRepairAttempted: false,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(action).toBe('fail');
  });
});
