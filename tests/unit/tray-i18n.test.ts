import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';

const electronMocks = vi.hoisted(() => {
  class MockTray {
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
  }

  return {
    MockTray,
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
    app: {
      name: 'ClawX',
      isPackaged: false,
      getLocale: () => 'en',
      quit: vi.fn(),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        setTemplateImage: vi.fn(),
      })),
    },
  };
});

vi.mock('electron', () => ({
  Tray: electronMocks.MockTray,
  Menu: {
    buildFromTemplate: electronMocks.buildFromTemplate,
  },
  BrowserWindow: class {},
  app: electronMocks.app,
  nativeImage: electronMocks.nativeImage,
}));

describe('tray i18n', () => {
  it('builds the tray menu from the selected locale labels', async () => {
    const { buildTrayMenuTemplate, getTrayMenuLabels } = await import('@electron/main/tray');
    const labels = getTrayMenuLabels('zh');
    const mainWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        send: vi.fn(),
      },
    } as unknown as BrowserWindow;

    const template = buildTrayMenuTemplate(mainWindow, labels);
    const quickActions = template.find((item) => item.label === '快捷操作');
    const submenu = quickActions?.submenu as MenuItemConstructorOptions[] | undefined;

    expect(template[0]?.label).toBe('显示 ClawX');
    expect(template[2]?.label).toBe('网关状态');
    expect(template[3]?.label).toBe('  运行中');
    expect(quickActions).toBeDefined();
    expect(submenu?.[0]?.label).toBe('打开聊天');
    expect(submenu?.[1]?.label).toBe('打开设置');
    expect(template.at(-3)?.label).toBe('检查更新...');
    expect(template.at(-1)?.label).toBe('退出 ClawX');
  });
});
