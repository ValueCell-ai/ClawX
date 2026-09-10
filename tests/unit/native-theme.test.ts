import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingMock, nativeThemeMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  nativeThemeMock: {
    themeSource: 'system' as 'light' | 'dark' | 'system',
    shouldUseDarkColors: false,
  },
}));

vi.mock('electron', () => ({
  nativeTheme: nativeThemeMock,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('native theme sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    nativeThemeMock.themeSource = 'system';
  });

  it('maps trusted theme values to matching theme sources', async () => {
    const { resolveNativeThemeSource } = await import('@electron/main/native-theme');

    expect(resolveNativeThemeSource('light')).toBe('light');
    expect(resolveNativeThemeSource('dark')).toBe('dark');
    expect(resolveNativeThemeSource('system')).toBe('system');
  });

  it('falls back to the system scheme for corrupted values', async () => {
    const { resolveNativeThemeSource } = await import('@electron/main/native-theme');

    expect(resolveNativeThemeSource(undefined)).toBe('system');
    expect(resolveNativeThemeSource(null)).toBe('system');
    expect(resolveNativeThemeSource('neon')).toBe('system');
    expect(resolveNativeThemeSource(42)).toBe('system');
  });

  it('applies the theme source to the Electron native theme', async () => {
    const { applyNativeThemeSetting } = await import('@electron/main/native-theme');

    await applyNativeThemeSetting('dark');
    expect(nativeThemeMock.themeSource).toBe('dark');

    await applyNativeThemeSetting('light');
    expect(nativeThemeMock.themeSource).toBe('light');

    await applyNativeThemeSetting('system');
    expect(nativeThemeMock.themeSource).toBe('system');
  });

  it('does not throw when Electron rejects the theme source', async () => {
    const { applyNativeThemeSetting } = await import('@electron/main/native-theme');

    const originalDescriptor = Object.getOwnPropertyDescriptor(nativeThemeMock, 'themeSource');
    Object.defineProperty(nativeThemeMock, 'themeSource', {
      configurable: true,
      set() {
        throw new Error('boom');
      },
      get() {
        return 'system';
      },
    });

    try {
      await expect(applyNativeThemeSetting('dark')).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(nativeThemeMock, 'themeSource', originalDescriptor);
    }
  });

  it('syncs the theme source from the persisted store value', async () => {
    const { syncNativeThemeFromStore } = await import('@electron/main/native-theme');

    getSettingMock.mockResolvedValue('dark');
    await syncNativeThemeFromStore();
    expect(getSettingMock).toHaveBeenCalledWith('theme');
    expect(nativeThemeMock.themeSource).toBe('dark');

    getSettingMock.mockResolvedValue('not-a-theme');
    await syncNativeThemeFromStore();
    expect(nativeThemeMock.themeSource).toBe('system');
  });
});
