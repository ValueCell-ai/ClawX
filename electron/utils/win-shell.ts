/**
 * Windows shell quoting utilities for child_process.spawn().
 *
 * When spawn() is called with `shell: true` on Windows, the command and
 * arguments are concatenated and passed to cmd.exe. Paths containing spaces
 * must be wrapped in double-quotes to prevent cmd.exe from splitting them
 * into separate tokens.
 *
 * This module is intentionally dependency-free so it can be unit-tested
 * without mocking Electron.
 */
import path from 'path';

/**
 * Quote a path/value for safe use with Windows cmd.exe (shell: true in spawn).
 *
 * When Node.js spawn is called with `shell: true` on Windows, cmd.exe
 * interprets spaces as argument separators. Wrapping the value in double
 * quotes prevents this. On non-Windows platforms the value is returned
 * unchanged so this function can be called unconditionally.
 */
export function quoteForCmd(value: string): string {
  if (process.platform !== 'win32') return value;
  if (!value.includes(' ')) return value;
  if (value.startsWith('"') && value.endsWith('"')) return value;
  return `"${value}"`;
}

/**
 * Determine whether a spawn call needs `shell: true` on Windows.
 *
 * Full (absolute) paths can be executed directly by the OS via
 * CreateProcessW, which handles spaces correctly without a shell.
 * Simple command names (e.g. 'uv', 'node') need shell for PATH/PATHEXT
 * resolution on Windows.
 */
export function needsWinShell(bin: string): boolean {
  if (process.platform !== 'win32') return false;
  return !path.win32.isAbsolute(bin);
}

/**
 * Prepare command and args for spawn(), handling Windows paths with spaces.
 *
 * Returns the shell option, the (possibly quoted) command, and the
 * (possibly quoted) args array ready for child_process.spawn().
 */
export function prepareWinSpawn(
  command: string,
  args: string[],
  forceShell?: boolean,
): { shell: boolean; command: string; args: string[] } {
  const isWin = process.platform === 'win32';
  const useShell = forceShell ?? (isWin && !path.win32.isAbsolute(command));

  if (!useShell || !isWin) {
    return { shell: useShell, command, args };
  }

  return {
    shell: true,
    command: quoteForCmd(command),
    args: args.map(a => quoteForCmd(a)),
  };
}
