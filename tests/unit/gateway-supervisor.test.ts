import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
  mockCreateServer,
  mockExistsSync,
  mockFork,
  mockGetUvMirrorEnv,
  mockGetActiveAcpChatService,
  mockStopAcp,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockCreateServer: vi.fn(),
  mockExistsSync: vi.fn(),
  mockFork: vi.fn(),
  mockGetUvMirrorEnv: vi.fn(),
  mockGetActiveAcpChatService: vi.fn(),
  mockStopAcp: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
  },
  utilityProcess: {},
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  execSync: vi.fn(),
  spawn: vi.fn(),
  default: {
    exec: mockExec,
    execSync: vi.fn(),
    spawn: vi.fn(),
  },
}));

vi.mock('net', () => ({
  createServer: mockCreateServer,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: { ...actual, existsSync: mockExistsSync },
  };
});

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => '/tmp/openclaw/openclaw.mjs',
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: mockGetUvMirrorEnv,
}));

vi.mock('@electron/utils/uv-setup', () => ({
  isPythonReady: vi.fn().mockResolvedValue(true),
  setupManagedPython: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-utility-process', () => ({
  forkOpenClawUtilityProcess: mockFork,
}));

vi.mock('@electron/services/acp-chat-service', () => ({
  getActiveAcpChatService: mockGetActiveAcpChatService,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('gateway supervisor process cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });

    mockCreateServer.mockImplementation(() => {
      const handlers = new Map<string, (...args: unknown[]) => void>();
      return {
        once(event: string, callback: (...args: unknown[]) => void) {
          handlers.set(event, callback);
          return this;
        },
        listen() {
          queueMicrotask(() => handlers.get('listening')?.());
          return this;
        },
        close(callback?: () => void) {
          callback?.();
        },
      };
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy for owned process on Windows', async () => {
    setPlatform('win32');
    const child = new MockUtilityChild(4321);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    await vi.waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith(
        'taskkill /F /PID 4321 /T',
        expect.objectContaining({ timeout: 5000, windowsHide: true }),
        expect.any(Function),
      );
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('uses direct child.kill for owned process on non-Windows', async () => {
    setPlatform('linux');
    const child = new MockUtilityChild(9876);
    const { terminateOwnedGatewayProcess } = await import('@electron/gateway/supervisor');

    const stopPromise = terminateOwnedGatewayProcess(child as unknown as Electron.UtilityProcess);
    child.emit('exit', 0);
    await stopPromise;

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('waits for port release after orphan cleanup on Windows', async () => {
    setPlatform('win32');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    const result = await findExistingGatewayProcess({ port: 18789 });
    expect(result).toBeNull();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /PID 4321 /T'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockCreateServer).toHaveBeenCalled();
  });
});

describe('gateway supervisor Doctor lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockGetUvMirrorEnv.mockResolvedValue({});
    mockGetActiveAcpChatService.mockReturnValue({ stop: mockStopAcp });
    mockStopAcp.mockResolvedValue(undefined);
  });

  async function prepareRepair() {
    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');
    const { GatewayLifecycleController, LifecycleSupersededError } = await import('@electron/gateway/lifecycle-controller');
    const lifecycle = new GatewayLifecycleController();
    const epoch = lifecycle.bump('start');
    return {
      lifecycle,
      LifecycleSupersededError,
      repair: () => runOpenClawDoctorRepair({
        assertLifecycle: () => lifecycle.assert(epoch, 'start/doctor-prepare'),
      }),
    };
  }

  it('does not stop ACP or launch Doctor after startup was already stopped', async () => {
    const { repair, lifecycle, LifecycleSupersededError } = await prepareRepair();
    lifecycle.bump('stop');

    await expect(repair()).rejects.toBeInstanceOf(LifecycleSupersededError);

    expect(mockGetActiveAcpChatService).not.toHaveBeenCalled();
    expect(mockStopAcp).not.toHaveBeenCalled();
    expect(mockGetUvMirrorEnv).not.toHaveBeenCalled();
    expect(mockFork).not.toHaveBeenCalled();
  });

  it('checks lifecycle after importing ACP before stopping its current service', async () => {
    const { repair, lifecycle, LifecycleSupersededError } = await prepareRepair();
    const result = repair();
    // The dynamic ACP import yields before the old repair can stop the service.
    lifecycle.bump('start');

    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);

    expect(mockStopAcp).not.toHaveBeenCalled();
    expect(mockGetUvMirrorEnv).not.toHaveBeenCalled();
    expect(mockFork).not.toHaveBeenCalled();
  });

  it('does not prepare or launch Doctor when stopping ACP outlives startup', async () => {
    let finishStop!: () => void;
    mockStopAcp.mockImplementation(() => new Promise<void>((resolve) => { finishStop = resolve; }));
    const { repair, lifecycle, LifecycleSupersededError } = await prepareRepair();
    const result = repair();
    await vi.waitFor(() => expect(mockStopAcp).toHaveBeenCalledTimes(1));

    lifecycle.bump('stop');
    finishStop();
    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);

    expect(mockGetUvMirrorEnv).not.toHaveBeenCalled();
    expect(mockFork).not.toHaveBeenCalled();
  });

  it('does not launch Doctor when environment preparation outlives startup', async () => {
    let finishEnv!: (env: Record<string, string>) => void;
    mockGetUvMirrorEnv.mockImplementation(() => new Promise<Record<string, string>>((resolve) => { finishEnv = resolve; }));
    const { repair, lifecycle, LifecycleSupersededError } = await prepareRepair();
    const result = repair();
    await vi.waitFor(() => expect(mockGetUvMirrorEnv).toHaveBeenCalledTimes(1));

    lifecycle.bump('stop');
    finishEnv({});
    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);

    expect(mockFork).not.toHaveBeenCalled();
  });

  it('lets an already-running Doctor finish migrations after startup is stopped', async () => {
    const child = new MockUtilityChild(4321);
    mockFork.mockReturnValue(child);
    const { repair, lifecycle } = await prepareRepair();
    const result = repair();
    await vi.waitFor(() => expect(mockFork).toHaveBeenCalledTimes(1));
    let settled = false;
    void result.then(() => { settled = true; });

    lifecycle.bump('stop');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit('exit', 0);
    await expect(result).resolves.toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('preserves best-effort ACP stop and callers without a lifecycle callback', async () => {
    const child = new MockUtilityChild(4321);
    mockFork.mockReturnValue(child);
    mockStopAcp.mockRejectedValue(new Error('ACP already exited'));
    const { runOpenClawDoctorRepair } = await import('@electron/gateway/supervisor');
    const result = runOpenClawDoctorRepair();
    await vi.waitFor(() => expect(mockFork).toHaveBeenCalledTimes(1));

    child.emit('exit', 0);
    await expect(result).resolves.toBe(true);
    expect(mockFork).toHaveBeenCalledWith(
      '/tmp/openclaw/openclaw.mjs',
      ['doctor', '--fix', '--yes', '--non-interactive'],
      expect.objectContaining({ stdio: 'pipe' }),
    );
  });
});
