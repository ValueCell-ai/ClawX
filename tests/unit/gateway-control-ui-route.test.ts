import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostApiContext } from '@electron/api/context';
import { handleGatewayRoutes } from '@electron/api/routes/gateway';

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => 'clawx-route-token'),
}));

function createResponse() {
  const headers = new Map<string, string>();
  let body = '';
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
    end: (value: string) => {
      body = value;
    },
  } as unknown as ServerResponse;

  return {
    res,
    get json() {
      return JSON.parse(body) as { success: boolean; url: string; token: string; port: number };
    },
    get statusCode() {
      return (res as ServerResponse).statusCode;
    },
    headers,
  };
}

function createContext(): HostApiContext {
  return {
    gatewayManager: {
      getStatus: () => ({ port: 19001 }),
    },
    clawHubService: {},
    eventBus: {},
    mainWindow: null,
  } as unknown as HostApiContext;
}

describe('GET /api/gateway/control-ui', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default Control UI URL', async () => {
    const response = createResponse();
    const handled = await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      response.res,
      new URL('http://127.0.0.1/api/gateway/control-ui'),
      createContext(),
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.json).toMatchObject({
      success: true,
      url: 'http://127.0.0.1:19001/#token=clawx-route-token',
      token: 'clawx-route-token',
      port: 19001,
    });
  });

  it('returns the Dreams Control UI URL', async () => {
    const response = createResponse();
    const handled = await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      response.res,
      new URL('http://127.0.0.1/api/gateway/control-ui?view=dreams'),
      createContext(),
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.json).toMatchObject({
      success: true,
      url: 'http://127.0.0.1:19001/dreaming#token=clawx-route-token',
      token: 'clawx-route-token',
      port: 19001,
    });
  });

  it('falls back to the default Control UI URL for unknown views', async () => {
    const response = createResponse();
    await handleGatewayRoutes(
      { method: 'GET' } as IncomingMessage,
      response.res,
      new URL('http://127.0.0.1/api/gateway/control-ui?view=unknown'),
      createContext(),
    );

    expect(response.json.url).toBe('http://127.0.0.1:19001/#token=clawx-route-token');
  });
});
