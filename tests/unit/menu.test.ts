// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
      send: vi.fn(),
    },
  };
  return {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
    window,
  };
});

vi.mock('electron', () => ({
  app: { name: 'ClawX', getLocale: () => 'en' },
  BrowserWindow: {
    getFocusedWindow: () => electronMock.window,
    getAllWindows: () => [electronMock.window],
  },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu,
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn().mockResolvedValue('en'),
}));

describe('application menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps reload commands clickable without registering accelerators', async () => {
    const { createMenu } = await import('@electron/main/menu');
    await createMenu('en');

    const template = electronMock.buildFromTemplate.mock.calls[0]?.[0] as Electron.MenuItemConstructorOptions[];
    const reloadItems = template
      .flatMap((item) => Array.isArray(item.submenu) ? item.submenu : [])
      .filter((item) => item.id === 'reload' || item.id === 'force-reload');

    expect(reloadItems).toHaveLength(2);
    expect(reloadItems.map((item) => item.id)).toEqual(['reload', 'force-reload']);
    expect(reloadItems.every((item) => !('accelerator' in item) && !('role' in item))).toBe(true);

    reloadItems[0]?.click?.(undefined as never, electronMock.window as never, undefined as never);
    reloadItems[1]?.click?.(undefined as never, electronMock.window as never, undefined as never);
    expect(electronMock.window.webContents.reload).toHaveBeenCalledTimes(1);
    expect(electronMock.window.webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1);
  });
});
