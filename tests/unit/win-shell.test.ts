/**
 * Windows shell quoting utilities tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We test the pure functions directly by dynamically importing after
// patching process.platform, since the functions check it at call time.
const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
});

describe('quoteForCmd', () => {
  let quoteForCmd: (value: string) => string;

  beforeEach(async () => {
    const mod = await import('@electron/utils/win-shell');
    quoteForCmd = mod.quoteForCmd;
  });

  it('returns value unchanged on non-Windows', () => {
    setPlatform('linux');
    expect(quoteForCmd('C:\\Program Files\\uv.exe')).toBe('C:\\Program Files\\uv.exe');
  });

  it('returns value unchanged on macOS', () => {
    setPlatform('darwin');
    expect(quoteForCmd('/Applications/My App/bin')).toBe('/Applications/My App/bin');
  });

  it('returns value unchanged on Windows when no spaces', () => {
    setPlatform('win32');
    expect(quoteForCmd('C:\\tools\\uv.exe')).toBe('C:\\tools\\uv.exe');
  });

  it('wraps in double quotes on Windows when path has spaces', () => {
    setPlatform('win32');
    expect(quoteForCmd('C:\\Program Files\\uv.exe')).toBe('"C:\\Program Files\\uv.exe"');
  });

  it('wraps user home paths with spaces', () => {
    setPlatform('win32');
    expect(quoteForCmd('C:\\Users\\John Doe\\AppData\\Local\\uv.exe'))
      .toBe('"C:\\Users\\John Doe\\AppData\\Local\\uv.exe"');
  });

  it('does not double-quote already quoted values', () => {
    setPlatform('win32');
    expect(quoteForCmd('"C:\\Program Files\\uv.exe"')).toBe('"C:\\Program Files\\uv.exe"');
  });

  it('handles simple command names without spaces', () => {
    setPlatform('win32');
    expect(quoteForCmd('uv')).toBe('uv');
    expect(quoteForCmd('node')).toBe('node');
    expect(quoteForCmd('pnpm')).toBe('pnpm');
  });

  it('handles empty string', () => {
    setPlatform('win32');
    expect(quoteForCmd('')).toBe('');
  });
});

describe('needsWinShell', () => {
  let needsWinShell: (bin: string) => boolean;

  beforeEach(async () => {
    const mod = await import('@electron/utils/win-shell');
    needsWinShell = mod.needsWinShell;
  });

  it('returns false on non-Windows', () => {
    setPlatform('linux');
    expect(needsWinShell('uv')).toBe(false);
    expect(needsWinShell('/usr/bin/uv')).toBe(false);
  });

  it('returns true on Windows for simple command names', () => {
    setPlatform('win32');
    expect(needsWinShell('uv')).toBe(true);
    expect(needsWinShell('node')).toBe(true);
    expect(needsWinShell('pnpm')).toBe(true);
  });

  it('returns false on Windows for absolute paths', () => {
    setPlatform('win32');
    expect(needsWinShell('C:\\Program Files\\uv.exe')).toBe(false);
    expect(needsWinShell('D:\\tools\\bin\\uv.exe')).toBe(false);
  });

  it('returns true on Windows for relative paths', () => {
    setPlatform('win32');
    expect(needsWinShell('bin\\uv.exe')).toBe(true);
    expect(needsWinShell('.\\uv.exe')).toBe(true);
  });
});

describe('prepareWinSpawn', () => {
  let prepareWinSpawn: (
    command: string,
    args: string[],
    forceShell?: boolean,
  ) => { shell: boolean; command: string; args: string[] };

  beforeEach(async () => {
    const mod = await import('@electron/utils/win-shell');
    prepareWinSpawn = mod.prepareWinSpawn;
  });

  it('does not quote on non-Windows', () => {
    setPlatform('linux');
    const result = prepareWinSpawn('/usr/bin/uv', ['python', 'install', '3.12']);
    expect(result.shell).toBe(false);
    expect(result.command).toBe('/usr/bin/uv');
    expect(result.args).toEqual(['python', 'install', '3.12']);
  });

  it('quotes command and args with spaces on Windows with shell', () => {
    setPlatform('win32');
    const result = prepareWinSpawn(
      'C:\\Program Files\\uv.exe',
      ['python', 'install', '3.12'],
      true,
    );
    expect(result.shell).toBe(true);
    expect(result.command).toBe('"C:\\Program Files\\uv.exe"');
    expect(result.args).toEqual(['python', 'install', '3.12']);
  });

  it('quotes args that contain spaces on Windows with shell', () => {
    setPlatform('win32');
    const result = prepareWinSpawn(
      'node',
      ['C:\\Users\\John Doe\\script.js', '--port', '18789'],
      true,
    );
    expect(result.shell).toBe(true);
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['"C:\\Users\\John Doe\\script.js"', '--port', '18789']);
  });

  it('auto-detects shell need based on absolute path on Windows', () => {
    setPlatform('win32');
    const absResult = prepareWinSpawn(
      'C:\\tools\\uv.exe',
      ['python', 'find', '3.12'],
    );
    expect(absResult.shell).toBe(false);

    const relResult = prepareWinSpawn(
      'uv',
      ['python', 'find', '3.12'],
    );
    expect(relResult.shell).toBe(true);
  });
});
