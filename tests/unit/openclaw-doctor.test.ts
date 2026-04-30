import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;

const {
  mockExistsSync,
  mockFork,
  mockGetUvMirrorEnv,
  mockLoggerWarn,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockFork: vi.fn(),
  mockGetUvMirrorEnv: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: mockFork,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => '/tmp/openclaw/openclaw-entry.js',
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: mockGetUvMirrorEnv,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: mockLoggerError,
  },
}));

class MockUtilityChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

describe('openclaw doctor output handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mockExistsSync.mockReturnValue(true);
    mockGetUvMirrorEnv.mockResolvedValue({});
  });

  it('collects normal output under the buffer limit', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('doctor ok\n'));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('doctor ok\n');
    expect(result.stderr).toBe('');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('truncates output when stdout exceeds MAX_DOCTOR_OUTPUT_BYTES', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('a'.repeat(MAX_DOCTOR_OUTPUT_BYTES - 5)));
    child.stdout.emit('data', Buffer.from('b'.repeat(10)));
    child.stdout.emit('data', Buffer.from('c'.repeat(1000)));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.stdout.length).toBe(MAX_DOCTOR_OUTPUT_BYTES);
    expect(result.stdout.endsWith('bbbbb')).toBe(true);
    expect(result.stdout.includes('c')).toBe(false);
  });

  it('logs a warning when truncation occurs', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('x'.repeat(MAX_DOCTOR_OUTPUT_BYTES + 1)));
    child.emit('exit', 0);

    await resultPromise;
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      `OpenClaw doctor stdout exceeded ${MAX_DOCTOR_OUTPUT_BYTES} bytes; truncating additional output`,
    );
  });

  it('collects stdout and stderr independently', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('line-1\n'));
    child.stderr.emit('data', Buffer.from('warn-1\n'));
    child.stdout.emit('data', Buffer.from('line-2\n'));
    child.stderr.emit('data', Buffer.from('warn-2\n'));
    child.emit('exit', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('line-1\nline-2\n');
    expect(result.stderr).toBe('warn-1\nwarn-2\n');
  });

  it('runs plain doctor command without --json', async () => {
    const child = new MockUtilityChild();
    mockFork.mockReturnValue(child);

    const { runOpenClawDoctor } = await import('@electron/utils/openclaw-doctor');
    const resultPromise = runOpenClawDoctor();

    await vi.waitFor(() => {
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit('data', Buffer.from('doctor ok\n'));
    child.emit('exit', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.command).toBe('openclaw doctor');
    expect(mockFork.mock.calls[0][1]).toEqual(['doctor']);
  });
});
