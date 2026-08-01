// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { withConfigLock } from '@electron/utils/config-mutex';

describe('config mutex', () => {
  it('serializes concurrent config operations', async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withConfigLock(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = withConfigLock(async () => {
      order.push('second');
    });

    await vi.waitFor(() => expect(order).toEqual(['first:start']));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('allows awaited nested config operations without deadlocking', async () => {
    const values: string[] = [];

    await withConfigLock(async () => {
      values.push('outer');
      await withConfigLock(async () => {
        values.push('inner');
      });
    });

    expect(values).toEqual(['outer', 'inner']);
  });
});
