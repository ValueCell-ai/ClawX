import { describe, expect, it } from 'vitest';
import {
  assertRuntimeOperationSupported,
  getRuntimeOperationCapability,
  getUnsupportedRuntimeOperation,
  isRuntimeOperationSupported,
} from '@/lib/runtime-operation-capabilities';
import type { GatewayStatus } from '@/types/gateway';

describe('runtime operation capability helpers', () => {
  it('allows operations when the runtime has not reported operation capabilities yet', () => {
    expect(isRuntimeOperationSupported(undefined, 'cron.run')).toBe(true);
    expect(() => assertRuntimeOperationSupported(undefined, 'cron.run')).not.toThrow();
  });

  it('blocks undeclared operations after the runtime publishes its operation contract', () => {
    const status: Pick<GatewayStatus, 'operationCapabilities'> = {
      operationCapabilities: {
        'cron.run': {
          capability: 'cron',
          support: 'native',
          notes: 'Uses runtime cron API.',
        },
      },
    };

    expect(isRuntimeOperationSupported(status, 'cron.create')).toBe(false);
    expect(() => assertRuntimeOperationSupported(status, 'cron.create'))
      .toThrow('Runtime operation cron.create is not declared');
  });

  it('returns the declared operation support entry', () => {
    const status: Pick<GatewayStatus, 'operationCapabilities'> = {
      operationCapabilities: {
        'cron.run': {
          capability: 'cron',
          support: 'native',
          notes: 'Uses runtime cron API.',
        },
      },
    };

    expect(getRuntimeOperationCapability(status, 'cron.run')).toMatchObject({
      capability: 'cron',
      support: 'native',
    });
    expect(getUnsupportedRuntimeOperation(status, 'cron.run')).toBeUndefined();
  });

  it('blocks operations explicitly marked unsupported', () => {
    const status: Pick<GatewayStatus, 'operationCapabilities'> = {
      operationCapabilities: {
        'doctor.fix': {
          capability: 'doctor',
          support: 'unsupported',
          notes: 'cc-connect does not support fix mode.',
        },
      },
    };

    expect(isRuntimeOperationSupported(status, 'doctor.fix')).toBe(false);
    expect(getUnsupportedRuntimeOperation(status, 'doctor.fix')).toMatchObject({
      capability: 'doctor',
      support: 'unsupported',
    });
    expect(() => assertRuntimeOperationSupported(status, 'doctor.fix'))
      .toThrow('Runtime operation doctor.fix is unavailable');
  });
});
