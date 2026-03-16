import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockSpawn,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockSpawn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
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

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  default: {
    spawn: mockSpawn,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/project/.openclaw',
  getOpenClawConfigPath: () => '/tmp/project/.openclaw/openclaw.json',
  getOpenClawDir: () => '/tmp/project/node_modules/openclaw',
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

function getPathValue(env: Record<string, string | undefined>): string {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return pathKey ? env[pathKey] ?? '' : '';
}

describe('runOpenClawLarkToolsInstall', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockExistsSync.mockImplementation((path) => String(path).includes('/tmp/project/node_modules/.bin/openclaw'));
  });

  it('runs the official Lark tools installer against the project-local OpenClaw state dir', async () => {
    const child = new MockChild();
    mockSpawn.mockReturnValue(child);

    const { runOpenClawLarkToolsInstall } = await import('@electron/utils/openclaw-lark-tools');
    const resultPromise = runOpenClawLarkToolsInstall({ appId: 'cli-app', appSecret: 'cli-secret' });

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    const [command, args, options] = mockSpawn.mock.calls[0] as [string, string[], { env: Record<string, string | undefined> }];
    expect(command).toBe(process.platform === 'win32' ? 'npx.cmd' : 'npx');
    expect(args).toEqual(['-y', '@larksuite/openclaw-lark-tools', 'install', '--app', 'cli-app:cli-secret']);
    expect(options.env.OPENCLAW_STATE_DIR).toBe('/tmp/project/.openclaw');
    expect(options.env.OPENCLAW_CONFIG_PATH).toBe('/tmp/project/.openclaw/openclaw.json');
    expect(getPathValue(options.env)).toContain('/tmp/project/node_modules/.bin');

    child.emit('exit', 0);
    const result = await resultPromise;
    expect(result.success).toBe(true);
  });

  it('uses --use-existing when no app credentials are provided', async () => {
    const child = new MockChild();
    mockSpawn.mockReturnValue(child);

    const { runOpenClawLarkToolsInstall } = await import('@electron/utils/openclaw-lark-tools');
    const resultPromise = runOpenClawLarkToolsInstall();

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    const [, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['-y', '@larksuite/openclaw-lark-tools', 'install', '--use-existing']);

    child.emit('exit', 0);
    await resultPromise;
  });
});
