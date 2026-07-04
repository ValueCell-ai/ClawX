import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openExternalMock = vi.fn();

vi.mock('electron', () => ({
  shell: {
    openExternal: openExternalMock,
  },
}));

describe('openExternalUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LAH_SAFE_MODE = '1';
  });

  afterEach(() => {
    delete process.env.LAH_SAFE_MODE;
  });

  it('blocks browser opening in LAH safe mode', async () => {
    const { openExternalUrl } = await import('@electron/utils/external-links');

    await openExternalUrl('https://example.com');

    expect(openExternalMock).not.toHaveBeenCalled();
  });
});
