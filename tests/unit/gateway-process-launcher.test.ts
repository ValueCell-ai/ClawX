// @vitest-environment node

import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/utils/openclaw-utility-process', () => ({
  forkOpenClawUtilityProcess: vi.fn(),
}));
vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: true,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

import { buildGatewayRuntimeEnv, launchGatewayProcess } from '@electron/gateway/process-launcher';
import { withCuaConnectionFileEnv } from '@electron/gateway/config-sync-env';
import { CLAWX_CUA_CONNECTION_FILE_ENV } from '@electron/utils/cua-runtime';
import { forkOpenClawUtilityProcess } from '@electron/utils/openclaw-utility-process';
import { logger } from '@electron/utils/logger';
import type { GatewayLaunchContext } from '@electron/gateway/config-sync';

describe('Gateway process output capture', () => {
  beforeEach(() => vi.clearAllMocks());

  async function launch() {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    vi.mocked(forkOpenClawUtilityProcess).mockReturnValue(child as unknown as Electron.UtilityProcess);
    const onStderrLine = vi.fn();
    const onStdoutLine = vi.fn();
    const onExit = vi.fn();
    const started = launchGatewayProcess({
      port: 18789,
      launchContext: {
        openclawDir: '/openclaw', entryScript: '/openclaw/openclaw.mjs',
        gatewayArgs: ['gateway'], forkEnv: {}, mode: 'packaged',
      } as GatewayLaunchContext,
      sanitizeSpawnArgs: (args) => args,
      getCurrentState: () => 'starting',
      getShouldReconnect: () => false,
      onSpawn: vi.fn(), onError: vi.fn(), onExit, onStderrLine, onStdoutLine,
    });
    child.emit('spawn');
    await started;
    return { child, onStderrLine, onStdoutLine, onExit };
  }

  it('reassembles independent stdout/stderr lines across UTF-8 and CRLF chunk boundaries', async () => {
    const { child, onStderrLine, onStdoutLine } = await launch();
    const output = Buffer.from('启动 [gateway] startup trace: plugins.bootstrap 12ms total=20ms\r\n');
    child.stdout.emit('data', output.subarray(0, 1));
    child.stderr.emit('data', Buffer.from('startup phase: gateway.server-'));
    child.stdout.emit('data', output.subarray(1, output.length - 1));
    expect(onStdoutLine).not.toHaveBeenCalled();
    expect(onStderrLine).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('start-import starting total=1ms\n'));
    child.stdout.emit('data', output.subarray(output.length - 1));

    expect(onStdoutLine.mock.calls).toEqual([['启动 [gateway] startup trace: plugins.bootstrap 12ms total=20ms']]);
    expect(onStderrLine.mock.calls).toEqual([['startup phase: gateway.server-start-import starting total=1ms']]);
  });

  it('flushes final partial lines once before notifying process exit', async () => {
    const { child, onStderrLine, onStdoutLine, onExit } = await launch();
    child.stdout.emit('data', Buffer.from('startup trace: ready 1ms total=100ms'));
    child.stderr.emit('data', Buffer.from('last diagnostic'));
    child.stdout.emit('end');
    child.emit('exit', 0);
    child.stderr.emit('end');

    expect(onStdoutLine.mock.calls).toEqual([['startup trace: ready 1ms total=100ms']]);
    expect(onStderrLine.mock.calls).toEqual([['last diagnostic']]);
    expect(onStderrLine.mock.invocationCallOrder[0]).toBeLessThan(onExit.mock.invocationCallOrder[0]!);
    expect(onExit).toHaveBeenCalledWith(child, 0);
  });

  it('discards oversized lines and resumes capture at the next newline without logging raw stdout', async () => {
    const { child, onStderrLine, onStdoutLine } = await launch();
    child.stdout.emit('data', Buffer.from('x'.repeat(64 * 1024)));
    child.stdout.emit('data', Buffer.from('overflow startup trace: misleading 1ms total=2ms\n'));
    child.stdout.emit('data', Buffer.from('secret-on-stdout\nstartup trace: ready 1ms total=10ms\n'));
    child.stderr.emit('data', Buffer.from('y'.repeat(70 * 1024) + '\nvalid stderr\n'));

    expect(onStdoutLine.mock.calls).toEqual([
      ['secret-on-stdout'], ['startup trace: ready 1ms total=10ms'],
    ]);
    expect(onStderrLine.mock.calls).toEqual([['valid stderr']]);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('secret-on-stdout');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret-on-stdout');
  });
});

describe('Gateway process launcher environment', () => {
  it('enables safe startup tracing and preserves the source environment', () => {
    const source = {
      PATH: '/usr/bin',
      OPENCLAW_DISABLE_BONJOUR: '0',
      OPENCLAW_GATEWAY_STARTUP_TRACE: '0',
    };

    expect(buildGatewayRuntimeEnv(source)).toEqual({
      PATH: '/usr/bin',
      OPENCLAW_DISABLE_BONJOUR: '1',
      OPENCLAW_GATEWAY_STARTUP_TRACE: '1',
    });
    expect(source).toEqual({
      PATH: '/usr/bin',
      OPENCLAW_DISABLE_BONJOUR: '0',
      OPENCLAW_GATEWAY_STARTUP_TRACE: '0',
    });
  });

  it('injects the stable CUA descriptor path only on macOS and Windows without mutating the source', () => {
    const source = {
      PATH: '/usr/bin',
      [CLAWX_CUA_CONNECTION_FILE_ENV]: '/inherited/connection.json',
    };

    expect(withCuaConnectionFileEnv(source, 'darwin', '/user-data')).toEqual({
      PATH: '/usr/bin',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      [CLAWX_CUA_CONNECTION_FILE_ENV]: join('/user-data', 'cua', 'connection.json'),
    });
    expect(withCuaConnectionFileEnv(source, 'win32', 'C:\\UserData')).toEqual({
      PATH: '/usr/bin',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      [CLAWX_CUA_CONNECTION_FILE_ENV]: join('C:\\UserData', 'cua', 'connection.json'),
    });
    expect(withCuaConnectionFileEnv(source, 'linux', '/user-data')).toEqual({
      PATH: '/usr/bin',
    });
    expect(source[CLAWX_CUA_CONNECTION_FILE_ENV]).toBe('/inherited/connection.json');
  });

  it.each(['darwin', 'win32'] as const)('disables CUA telemetry for %s CLI children without changing the parent', (platform) => {
    const source = {
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'true',
      CUA_TELEMETRY_ENABLED: 'true',
      UNRELATED_SETTING: 'keep',
    };
    const original = { ...source };
    const env = buildGatewayRuntimeEnv(withCuaConnectionFileEnv(source, platform, '/user-data'));
    expect(env.CUA_DRIVER_RS_TELEMETRY_ENABLED).toBe('false');
    expect(env.CUA_TELEMETRY_ENABLED).toBe('true');
    expect(env.UNRELATED_SETTING).toBe('keep');
    expect(source).toEqual(original);
    expect(withCuaConnectionFileEnv(source, 'linux', '/user-data')).toEqual(source);
  });
});
