// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({ app: { on: vi.fn() } }));
vi.mock('electron', () => electronMock);

import { registerMainWindowGuard } from '@electron/main/main-window-guard';

function window() {
  return {
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    webContents: { devToolsWebContents: null as unknown },
  };
}

describe('main window guard', () => {
  let events: EventEmitter;
  let main: ReturnType<typeof window> | null;
  let focusMain: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    events = new EventEmitter();
    electronMock.app.on.mockImplementation((event, handler) => events.on(event, handler));
    main = null;
    focusMain = vi.fn();
    registerMainWindowGuard(() => main as unknown as BrowserWindow | null, focusMain);
  });

  it('allows initial creation and recreation when the singleton is assigned after the constructor event', async () => {
    for (let i = 0; i < 2; i++) {
      main = null;
      const candidate = window();
      events.emit('browser-window-created', {}, candidate);
      main = candidate;
      await Promise.resolve();
      expect(candidate.destroy).not.toHaveBeenCalled();
    }
    expect(focusMain).not.toHaveBeenCalled();
  });

  it('destroys an unexpected secondary window and focuses main without changing its identity', async () => {
    main = window();
    const secondary = window();
    events.emit('browser-window-created', {}, secondary);
    await Promise.resolve();

    expect(secondary.destroy).toHaveBeenCalledOnce();
    expect(main.destroy).not.toHaveBeenCalled();
    expect(focusMain).toHaveBeenCalledOnce();
  });

  it('preserves detached developer tools', async () => {
    main = window();
    const devTools = window();
    events.emit('browser-window-created', {}, devTools);
    main.webContents.devToolsWebContents = devTools.webContents;
    await Promise.resolve();
    expect(devTools.destroy).not.toHaveBeenCalled();
    expect(focusMain).not.toHaveBeenCalled();
  });

  it('ignores destroyed windows and a missing or destroyed main', async () => {
    const secondary = window();
    events.emit('browser-window-created', {}, secondary);
    await Promise.resolve();
    main = window();
    main.isDestroyed.mockReturnValue(true);
    events.emit('browser-window-created', {}, secondary);
    await Promise.resolve();
    main.isDestroyed.mockReturnValue(false);
    secondary.isDestroyed.mockReturnValue(true);
    events.emit('browser-window-created', {}, secondary);
    await Promise.resolve();
    expect(secondary.destroy).not.toHaveBeenCalled();
    expect(focusMain).not.toHaveBeenCalled();
  });
});
