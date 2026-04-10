import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { mockFork, mockLogger } = vi.hoisted(() => ({
  mockFork: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: (...args: unknown[]) => mockFork(...args),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const mocked = {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => '/tmp/openclaw/openclaw.mjs',
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: vi.fn().mockResolvedValue({}),
}));

vi.mock('@electron/utils/env-path', () => ({
  prependPathEntry: vi.fn((env: Record<string, string | undefined>) => ({ env })),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: mockLogger,
}));

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout?: EventEmitter;
    stderr?: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('runOpenClawDoctorRepair', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('treats an exit code 0 during timeout grace as success', async () => {
    const child = createMockChild();
    mockFork.mockReturnValueOnce(child);

    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');
    const repairPromise = runOpenClawDoctorRepair();

    await vi.advanceTimersByTimeAsync(120000);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenClaw doctor repair timed out after 120000ms'),
    );

    child.emit('exit', 0);

    await expect(repairPromise).resolves.toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'OpenClaw doctor repair completed successfully after timeout grace',
    );
  });

  it('kills the process and fails when no exit arrives during timeout grace', async () => {
    const child = createMockChild();
    mockFork.mockReturnValueOnce(child);

    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');
    const repairPromise = runOpenClawDoctorRepair();

    await vi.advanceTimersByTimeAsync(125000);

    await expect(repairPromise).resolves.toBe(false);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('grace period after timeout; terminating process'),
    );
  });
});
