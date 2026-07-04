import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExec = vi.fn();

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
  });

  it('skips orphan cleanup when kill-on-conflict is disabled', async () => {
    const { findExistingGatewayProcess } = await import('@electron/gateway/supervisor');

    const result = await findExistingGatewayProcess({ port: 18789, ownedPid: 4321 });

    expect(result).toBeNull();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
