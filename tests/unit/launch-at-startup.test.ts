import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  testHome,
  electronAppMock,
  setLoginItemSettingsMock,
} = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const setLoginItemSettingsMock = vi.fn();
  const electronAppMock = {
    isPackaged: true,
    getPath: (name: string) => (name === 'home' ? `/tmp/clawx-launch-startup-${suffix}` : '/tmp'),
    setLoginItemSettings: setLoginItemSettingsMock,
  };

  return {
    testHome: `/tmp/clawx-launch-startup-${suffix}`,
    electronAppMock,
    setLoginItemSettingsMock,
  };
});

vi.mock('electron', () => ({
  app: electronAppMock,
}));

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('launch-at-startup integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    electronAppMock.isPackaged = true;
    await rm(testHome, { recursive: true, force: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses login item settings on Windows', async () => {
    setPlatform('win32');
    const { applyLaunchAtStartupSetting } = await import('@electron/main/launch-at-startup');

    await applyLaunchAtStartupSetting(true);
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: false,
    });
  });

  it('uses login item settings on macOS', async () => {
    setPlatform('darwin');
    const { applyLaunchAtStartupSetting } = await import('@electron/main/launch-at-startup');

    await applyLaunchAtStartupSetting(false);
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({
      openAtLogin: false,
      openAsHidden: false,
    });
  });

  it('creates and removes Linux autostart desktop entry', async () => {
    setPlatform('linux');
    const { applyLaunchAtStartupSetting } = await import('@electron/main/launch-at-startup');

    const autostartPath = join(testHome, '.config', 'autostart', 'clawx.desktop');
    await applyLaunchAtStartupSetting(true);

    const content = await readFile(autostartPath, 'utf8');
    expect(content).toContain('[Desktop Entry]');
    expect(content).toContain('Name=ClawX');
    expect(content).toContain('Exec=');

    await applyLaunchAtStartupSetting(false);
    await expect(access(autostartPath)).rejects.toThrow();
  });

  it('does not throw on unsupported platforms', async () => {
    setPlatform('freebsd');
    const { applyLaunchAtStartupSetting } = await import('@electron/main/launch-at-startup');

    await expect(applyLaunchAtStartupSetting(true)).resolves.toBeUndefined();
  });
});
