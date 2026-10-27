// @vitest-environment node

import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { isNewChatShortcut, registerNewChatShortcut } from '@electron/main/new-chat-shortcut';

function input(overrides: Partial<Electron.Input> = {}): Electron.Input {
  return {
    type: 'keyDown',
    key: 'n',
    code: 'KeyN',
    isAutoRepeat: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  };
}

describe('New Chat shortcut', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('recognizes only the command modifier on %s', (platform) => {
    const modifiers = platform === 'darwin' ? { meta: true } : { control: true };
    expect(isNewChatShortcut(input(modifiers), platform)).toBe(true);
    expect(isNewChatShortcut(input({ ...modifiers, key: 'N' }), platform)).toBe(true);
    expect(isNewChatShortcut(input(), platform)).toBe(false);
    expect(isNewChatShortcut(input(platform === 'darwin' ? { control: true } : { meta: true }), platform)).toBe(false);

    for (const extra of [
      { type: 'keyUp' as const },
      { key: 'm', code: 'KeyM' },
      { alt: true },
      { shift: true },
      { control: true, meta: true },
    ]) {
      expect(isNewChatShortcut(input({ ...modifiers, ...extra }), platform)).toBe(false);
    }
  });

  it('prevents default before invoking the shared action once per keydown/keyup pair', () => {
    const contents = new EventEmitter();
    const win = { webContents: contents } as unknown as BrowserWindow;
    const calls: string[] = [];
    const onNewChat = vi.fn(() => calls.push('new-chat'));
    const preventDefault = vi.fn(() => calls.push('preventDefault'));
    registerNewChatShortcut(win, onNewChat);
    const modifiers = process.platform === 'darwin' ? { meta: true } : { control: true };

    contents.emit('before-input-event', { preventDefault }, input(modifiers));
    contents.emit('before-input-event', { preventDefault }, input({ ...modifiers, type: 'keyUp' }));

    expect(calls).toEqual(['preventDefault', 'new-chat']);
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves unrelated input and modified New Window shortcuts unhandled', () => {
    const contents = new EventEmitter();
    const win = { webContents: contents } as unknown as BrowserWindow;
    const onNewChat = vi.fn();
    const preventDefault = vi.fn();
    registerNewChatShortcut(win, onNewChat);
    const modifiers = process.platform === 'darwin' ? { meta: true } : { control: true };

    for (const unrelated of [input(), input({ ...modifiers, key: 'r' }), input({ ...modifiers, shift: true })]) {
      contents.emit('before-input-event', { preventDefault }, unrelated);
    }

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onNewChat).not.toHaveBeenCalled();
  });
});
