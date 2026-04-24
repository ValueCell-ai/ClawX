import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

const {
  mockApp,
  mockLoggerInfo,
  mockLoggerWarn,
  mockProxyAwareFetch,
} = vi.hoisted(() => ({
  mockApp: {
    getLocale: vi.fn(),
    isReady: vi.fn(),
    whenReady: vi.fn(),
  },
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockProxyAwareFetch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
  },
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: mockProxyAwareFetch,
}));

describe('uv-env network reachability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.getLocale.mockReturnValue('en-US');
    mockApp.isReady.mockReturnValue(true);
    mockApp.whenReady.mockResolvedValue(undefined);
    mockProxyAwareFetch.mockResolvedValue({ status: 204 });
    Intl.DateTimeFormat.prototype.resolvedOptions = () => ({ timeZone: 'UTC' }) as Intl.ResolvedDateTimeFormatOptions;
  });

  it('uses Google reachability in normal regions', async () => {
    const { canReachManagedPythonDownloadSource } = await import('@electron/utils/uv-env');

    const reachable = await canReachManagedPythonDownloadSource();

    expect(reachable).toBe(true);
    expect(mockProxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://www.google.com/generate_204',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockProxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://www.google.com/generate_204',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses the managed python mirror reachability when region optimization is enabled', async () => {
    mockApp.getLocale.mockReturnValue('zh-CN');
    Intl.DateTimeFormat.prototype.resolvedOptions = () => ({ timeZone: 'Asia/Shanghai' }) as Intl.ResolvedDateTimeFormatOptions;
    mockProxyAwareFetch.mockResolvedValue({ status: 200 });

    const { canReachManagedPythonDownloadSource } = await import('@electron/utils/uv-env');

    const reachable = await canReachManagedPythonDownloadSource();

    expect(reachable).toBe(true);
    expect(mockProxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://registry.npmmirror.com/-/binary/python-build-standalone/',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns false when the probe fetch fails', async () => {
    mockProxyAwareFetch.mockRejectedValue(new Error('offline'));

    const { canReachManagedPythonDownloadSource } = await import('@electron/utils/uv-env');

    await expect(canReachManagedPythonDownloadSource()).resolves.toBe(false);
  });

  it('prefers timezone over locale when deciding managed python mirror usage', async () => {
    mockApp.getLocale.mockReturnValue('zh-CN');
    Intl.DateTimeFormat.prototype.resolvedOptions = () => ({ timeZone: 'UTC' }) as Intl.ResolvedDateTimeFormatOptions;

    const { canReachManagedPythonDownloadSource } = await import('@electron/utils/uv-env');

    await expect(canReachManagedPythonDownloadSource()).resolves.toBe(true);
    expect(mockProxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://www.google.com/generate_204',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockProxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://www.google.com/generate_204',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
});
