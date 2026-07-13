import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/clawx-logger-exit-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
}));

describe('logger exit handler', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('registers at most one process exit listener across module reloads', async () => {
    const before = process.listenerCount('exit');

    await import('@electron/utils/logger');
    vi.resetModules();
    await import('@electron/utils/logger');
    vi.resetModules();
    await import('@electron/utils/logger');

    const after = process.listenerCount('exit');
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
