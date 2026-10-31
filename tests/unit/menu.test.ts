// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
      send: vi.fn(),
    },
  };
  return {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
    getFocusedWindow: vi.fn(() => window),
    window,
  };
});

vi.mock('electron', () => ({
  app: { name: 'ClawX', getLocale: () => 'en' },
  BrowserWindow: {
    getFocusedWindow: electronMock.getFocusedWindow,
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
    electronMock.window.isDestroyed.mockReturnValue(false);
    electronMock.window.isMinimized.mockReturnValue(false);
    electronMock.getFocusedWindow.mockReturnValue(electronMock.window);
  });

  function newChatItem(): Electron.MenuItemConstructorOptions {
    const template = electronMock.buildFromTemplate.mock.lastCall?.[0] as Electron.MenuItemConstructorOptions[];
    return template.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : [])
      .find((item) => item.id === 'new-chat')!;
  }

  it('claims CmdOrCtrl+N and sends New Chat only to main even when another window is focused', async () => {
    const { createMenu } = await import('@electron/main/menu');
    const secondary = { ...electronMock.window, webContents: { send: vi.fn() } };
    electronMock.getFocusedWindow.mockReturnValue(secondary as never);
    electronMock.window.isMinimized.mockReturnValue(true);
    await createMenu('en', () => electronMock.window as never);

    const item = newChatItem();
    expect(item.accelerator).toBe('CmdOrCtrl+N');
    expect(item.role).toBeUndefined();
    item.click?.(undefined as never, secondary as never, undefined as never);

    expect(electronMock.window.restore).toHaveBeenCalledOnce();
    expect(electronMock.window.show).toHaveBeenCalledOnce();
    expect(electronMock.window.focus).toHaveBeenCalledOnce();
    expect(electronMock.window.webContents.send).toHaveBeenCalledExactlyOnceWith('new-chat');
    expect(secondary.webContents.send).not.toHaveBeenCalled();
  });

  it('retains the singleton provider across language rebuilds and resolves recreated main windows', async () => {
    const { createMenu } = await import('@electron/main/menu');
    let main = electronMock.window;
    await createMenu('en', () => main as never);
    const recreated = { ...electronMock.window, webContents: { ...electronMock.window.webContents, send: vi.fn() } };
    main = recreated;
    await createMenu('zh');
    newChatItem().click?.(undefined as never, electronMock.window as never, undefined as never);

    expect(recreated.webContents.send).toHaveBeenCalledExactlyOnceWith('new-chat');
    expect(electronMock.window.webContents.send).not.toHaveBeenCalled();
  });

  it('does not fall back to a secondary window when main is absent or destroyed', async () => {
    const { createMenu } = await import('@electron/main/menu');
    await createMenu('en', () => null);
    newChatItem().click?.(undefined as never, electronMock.window as never, undefined as never);
    electronMock.window.isDestroyed.mockReturnValue(true);
    await createMenu('en', () => electronMock.window as never);
    newChatItem().click?.(undefined as never, electronMock.window as never, undefined as never);

    expect(electronMock.window.webContents.send).not.toHaveBeenCalled();
    expect(electronMock.window.focus).not.toHaveBeenCalled();
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
