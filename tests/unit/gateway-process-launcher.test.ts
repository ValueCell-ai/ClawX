// @vitest-environment node

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
});
