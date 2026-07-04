import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExec = vi.fn();
const mockProbeGatewayReady = vi.fn();
const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

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
  createServer: vi.fn(),
}));

vi.mock('@electron/utils/runtime-flags', () => ({
  isGatewayKillOnConflictEnabled: () => false,
}));

vi.mock('@electron/gateway/ws-client', () => ({
  probeGatewayReady: mockProbeGatewayReady,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('gateway supervisor safe mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProbeGatewayReady.mockReset();
    setPlatform('win32');
    mockExec.mockImplementation((cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      if (cmd.includes('netstat -ano')) {
        cb(null, '  TCP    127.0.0.1:18789    0.0.0.0:0    LISTENING    4321\n');
        return {} as never;
      }
      cb(null, '');
      return {} as never;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('skips orphan cleanup when kill-on-conflict is disabled', async () => {
    mockProbeGatewayReady.mockResolvedValue(false);
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    const result = await findExistingGatewayProcess({ port: 18789, ownedPid: 9999 });

    expect(result).toBeNull();
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('netstat -ano'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockExec.mock.calls.some(([cmd]) => String(cmd).includes('taskkill'))).toBe(false);
    expect(mockProbeGatewayReady).toHaveBeenCalledWith(18789, 5000);
  });

  it('still attaches to a healthy existing gateway when kill-on-conflict is disabled', async () => {
    mockProbeGatewayReady.mockResolvedValue(true);
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    const result = await findExistingGatewayProcess({ port: 18789, ownedPid: 9999 });

    expect(result).toEqual({ port: 18789 });
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('netstat -ano'),
      expect.objectContaining({ timeout: 5000, windowsHide: true }),
      expect.any(Function),
    );
    expect(mockExec.mock.calls.some(([cmd]) => String(cmd).includes('taskkill'))).toBe(false);
    expect(mockProbeGatewayReady).toHaveBeenCalledWith(18789, 5000);
  });
});
