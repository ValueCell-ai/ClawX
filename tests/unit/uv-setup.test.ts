import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSpawn,
  mockExecSync,
  mockExistsSync,
  mockIsPackaged,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackaged: { value: false },
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mockIsPackaged.value; },
    getPath: () => '/tmp',
  },
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
  default: { spawn: mockSpawn, execSync: mockExecSync },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: mockExistsSync };
});

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('@electron/utils/paths', () => ({
  quoteForCmd: (s: string) => s,
  needsWinShell: () => false,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('uv-setup: Python installation error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.clearAllTimers();
    mockIsPackaged.value = true;
    mockExistsSync.mockReturnValue(true);
    Object.defineProperty(process, 'resourcesPath', { value: '/resources', writable: true });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('includes network-connectivity hint when ECONNREFUSED appears in output', async () => {
    const failingChild = new MockChildProcess();
    mockSpawn.mockReturnValue(failingChild);

    const { setupManagedPython } = await import('@electron/utils/uv-setup');
    const promise = setupManagedPython();

    await Promise.resolve();
    failingChild.stderr.emit('data', Buffer.from('error: failed to fetch: ECONNREFUSED'));
    failingChild.emit('close', 1);
    await Promise.resolve();

    // Clear pending timer so test doesn't hang
    vi.clearAllTimers();

    let errorMsg = '';
    try {
      await promise;
    } catch (e) {
      errorMsg = (e as Error).message;
    }

    expect(errorMsg).toMatch(/ECONNREFUSED/);
    expect(errorMsg).toMatch(/network error/i);
  });

  it('includes network-connectivity hint for "failed to fetch" errors', async () => {
    const failingChild = new MockChildProcess();
    mockSpawn.mockReturnValue(failingChild);

    const { setupManagedPython } = await import('@electron/utils/uv-setup');
    const promise = setupManagedPython();

    await Promise.resolve();
    failingChild.stderr.emit('data', Buffer.from('error: download failed for python-3.12-x86_64'));
    failingChild.emit('close', 1);
    await Promise.resolve();

    vi.clearAllTimers();

    let errorMsg = '';
    try {
      await promise;
    } catch (e) {
      errorMsg = (e as Error).message;
    }

    expect(errorMsg).toMatch(/download.*failed/i);
    expect(errorMsg).toMatch(/network error/i);
  });

  it('does not include network hint for unrelated failures', async () => {
    const failingChild = new MockChildProcess();
    mockSpawn.mockReturnValue(failingChild);

    const { setupManagedPython } = await import('@electron/utils/uv-setup');
    const promise = setupManagedPython();

    await Promise.resolve();
    failingChild.stderr.emit('data', Buffer.from('error: permission denied /home/user/.uv/'));
    failingChild.emit('close', 1);
    await Promise.resolve();

    vi.clearAllTimers();

    let errorMsg = '';
    try {
      await promise;
    } catch (e) {
      errorMsg = (e as Error).message;
    }

    expect(errorMsg).toMatch(/permission denied/i);
    expect(errorMsg).not.toMatch(/network error/i);
  });
});
