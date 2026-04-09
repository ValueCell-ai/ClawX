import { describe, expect, it } from 'vitest';
import {
  getDeferredRestartAction,
  getReconnectScheduleDecision,
  getReconnectSkipReason,
  isLifecycleSuperseded,
  nextLifecycleEpoch,
  shouldDeferRestart,
} from '@electron/gateway/process-policy';

describe('gateway process policy helpers', () => {
  describe('lifecycle epoch helpers', () => {
    it('increments lifecycle epoch by one', () => {
      expect(nextLifecycleEpoch(0)).toBe(1);
      expect(nextLifecycleEpoch(5)).toBe(6);
    });

    it('detects superseded lifecycle epochs', () => {
      expect(isLifecycleSuperseded(3, 4)).toBe(true);
      expect(isLifecycleSuperseded(8, 8)).toBe(false);
    });
  });

  describe('getReconnectSkipReason', () => {
    it('skips reconnect when auto-reconnect is disabled', () => {
      expect(
        getReconnectSkipReason({
          scheduledEpoch: 10,
          currentEpoch: 10,
          shouldReconnect: false,
        })
      ).toBe('auto-reconnect disabled');
    });

    it('skips stale reconnect callbacks when lifecycle epoch changed', () => {
      expect(
        getReconnectSkipReason({
          scheduledEpoch: 11,
          currentEpoch: 12,
          shouldReconnect: true,
        })
      ).toContain('stale reconnect callback');
    });

    it('allows reconnect when callback is current and reconnect enabled', () => {
      expect(
        getReconnectSkipReason({
          scheduledEpoch: 7,
          currentEpoch: 7,
          shouldReconnect: true,
        })
      ).toBeNull();
    });
  });

  describe('restart deferral policy', () => {
    it('defers restart while startup or reconnect is in progress', () => {
      expect(shouldDeferRestart({ state: 'starting', startLock: false })).toBe(true);
      expect(shouldDeferRestart({ state: 'reconnecting', startLock: false })).toBe(true);
      expect(shouldDeferRestart({ state: 'running', startLock: true })).toBe(true);
    });

    it('does not defer restart for stable states when no start lock', () => {
      expect(shouldDeferRestart({ state: 'running', startLock: false })).toBe(false);
      expect(shouldDeferRestart({ state: 'stopped', startLock: false })).toBe(false);
      expect(shouldDeferRestart({ state: 'error', startLock: false })).toBe(false);
    });

    it('executes deferred restart even after lifecycle recovers to running', () => {
      expect(
        getDeferredRestartAction({
          hasPendingRestart: true,
          state: 'running',
          startLock: false,
          shouldReconnect: true,
        })
      ).toBe('execute');
    });

    it('waits deferred restart while lifecycle is still busy', () => {
      expect(
        getDeferredRestartAction({
          hasPendingRestart: true,
          state: 'starting',
          startLock: false,
          shouldReconnect: true,
        })
      ).toBe('wait');
    });

    it('executes deferred restart when manager is idle and not running', () => {
      expect(
        getDeferredRestartAction({
          hasPendingRestart: true,
          state: 'error',
          startLock: false,
          shouldReconnect: true,
        })
      ).toBe('execute');
    });

    it('drops deferred restart when reconnect is disabled', () => {
      expect(
        getDeferredRestartAction({
          hasPendingRestart: true,
          state: 'stopped',
          startLock: false,
          shouldReconnect: false,
        })
      ).toBe('drop');
    });
  });

  describe('getReconnectScheduleDecision', () => {
    const baseContext = {
      shouldReconnect: true,
      hasReconnectTimer: false,
      reconnectAttempts: 0,
      maxAttempts: 10,
      baseDelay: 1000,
      maxDelay: 30000,
    };

    it('skips reconnect when shouldReconnect is false (intentional stop)', () => {
      const decision = getReconnectScheduleDecision({
        ...baseContext,
        shouldReconnect: false,
      });
      expect(decision).toEqual({ action: 'skip', reason: 'auto-reconnect disabled' });
    });

    it('returns already-scheduled when a reconnect timer exists (prevents double-scheduling)', () => {
      const decision = getReconnectScheduleDecision({
        ...baseContext,
        hasReconnectTimer: true,
      });
      expect(decision).toEqual({ action: 'already-scheduled' });
    });

    it('fails when max reconnect attempts are exhausted', () => {
      const decision = getReconnectScheduleDecision({
        ...baseContext,
        reconnectAttempts: 10,
        maxAttempts: 10,
      });
      expect(decision).toEqual({ action: 'fail', attempts: 10, maxAttempts: 10 });
    });

    it('schedules reconnect with exponential backoff delay', () => {
      const decision = getReconnectScheduleDecision({
        ...baseContext,
        reconnectAttempts: 0,
      });
      expect(decision).toEqual({
        action: 'schedule',
        nextAttempt: 1,
        maxAttempts: 10,
        delay: 1000,
      });
    });

    it('caps backoff delay at maxDelay', () => {
      const decision = getReconnectScheduleDecision({
        ...baseContext,
        reconnectAttempts: 8,
        maxDelay: 30000,
      });
      expect(decision).toMatchObject({ action: 'schedule' });
      if (decision.action === 'schedule') {
        expect(decision.delay).toBeLessThanOrEqual(30000);
      }
    });
  });
});
