// @vitest-environment node

import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: true,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

import { buildGatewayRuntimeEnv } from '@electron/gateway/process-launcher';
import { withCuaConnectionFileEnv } from '@electron/gateway/config-sync-env';
import { CLAWX_CUA_CONNECTION_FILE_ENV } from '@electron/utils/cua-runtime';

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
      [CLAWX_CUA_CONNECTION_FILE_ENV]: join('/user-data', 'cua', 'connection.json'),
    });
    expect(withCuaConnectionFileEnv(source, 'win32', 'C:\\UserData')).toEqual({
      PATH: '/usr/bin',
      [CLAWX_CUA_CONNECTION_FILE_ENV]: join('C:\\UserData', 'cua', 'connection.json'),
    });
    expect(withCuaConnectionFileEnv(source, 'linux', '/user-data')).toEqual({
      PATH: '/usr/bin',
    });
    expect(source[CLAWX_CUA_CONNECTION_FILE_ENV]).toBe('/inherited/connection.json');
  });
});
