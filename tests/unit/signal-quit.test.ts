import { describe, expect, it, vi } from 'vitest';
import { createSignalQuitHandler } from '@electron/main/signal-quit';

describe('signal quit handler', () => {
  it('logs and requests quit when signal is received', () => {
    const logInfo = vi.fn();
    const requestQuit = vi.fn();
    const handler = createSignalQuitHandler({ logInfo, requestQuit });

    handler('SIGTERM');

    expect(logInfo).toHaveBeenCalledWith('Received SIGTERM; requesting app quit');
    expect(requestQuit).toHaveBeenCalledTimes(1);
  });
});
