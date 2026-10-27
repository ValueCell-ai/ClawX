import type { BrowserWindow } from 'electron';

type NewChatShortcutInput = Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift'>;

export function isNewChatShortcut(
  input: NewChatShortcutInput,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const commandModifier = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  return input.type === 'keyDown' && commandModifier && !input.alt && !input.shift
    && input.key.toLowerCase() === 'n';
}

export function registerNewChatShortcut(win: BrowserWindow, onNewChat: () => void): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (!isNewChatShortcut(input)) return;

    // preventDefault also cancels menu accelerators (Electron #19279). Invoke
    // the same action explicitly, including for macOS input that bypasses NSMenu.
    event.preventDefault();
    onNewChat();
  });
}
