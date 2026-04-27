import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExec,
  mockCreateServer,
  mockProbeGatewayReady,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockCreateServer: vi.fn(),
  mockProbeGatewayReady: vi.fn(),
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

vi.mock('@electron/gateway/ws-client', () => ({
  probeGatewayReady: mockProbeGatewayReady,
}));

class MockUtilityChild extends EventEmitter {
  pid?: number;
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

    mockProbeGatewayReady.mockResolvedValue(false);
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

    // Probe fails — orphaned process is not a healthy gateway
    mockProbeGatewayReady.mockResolvedValue(false);

    const result = await findExistingGatewayProcess({ port: 18789 });
    expect(result).toBeNull();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('taskkill /F /PID 4321 /T'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockCreateServer).toHaveBeenCalled();
  });

  it('adopts an external gateway when WebSocket probe succeeds', async () => {
    setPlatform('linux');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('lsof')) {
        cb(null, '5555\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    // Healthy external gateway is running
    mockProbeGatewayReady.mockResolvedValue(true);

    const result = await findExistingGatewayProcess({ port: 18789 });
    expect(result).toEqual({ port: 18789 });

    // Should NOT have attempted to kill the process
    expect(mockExec).not.toHaveBeenCalledWith(
      expect.stringContaining('SIGTERM'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('stops systemd service before killing orphan on Linux', { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    setPlatform('linux');
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('lsof')) {
        cb(null, '7777\n');
        return {} as never;
      }
      if (cmd.includes('systemctl --user is-active')) {
        cb(null, 'active');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });

    // Probe fails — not a healthy gateway
    mockProbeGatewayReady.mockResolvedValue(false);

    const resultPromise = findExistingGatewayProcess({ port: 18789 });
    // Advance past all internal setTimeout delays
    await vi.advanceTimersByTimeAsync(10000);
    const result = await resultPromise;
    expect(result).toBeNull();

    expect(mockExec).toHaveBeenCalledWith(
      'systemctl --user is-active openclaw-gateway',
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    expect(mockExec).toHaveBeenCalledWith(
      'systemctl --user stop openclaw-gateway',
      expect.objectContaining({ timeout: 10000 }),
      expect.any(Function),
    );
    vi.useRealTimers();
  });
});
