import { ipcMain } from 'electron';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getPort } from '../../utils/config';
import { getHostApiToken } from '../../api/server';

type HostApiFetchRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export function registerHostApiProxyHandlers(): void {
  const hostApiPort = getPort('CLAWX_HOST_API');

  // Expose the per-session auth token to the renderer so the browser-fallback
  // path in host-api.ts can authenticate against the Host API server.
  ipcMain.handle('hostapi:token', () => getHostApiToken());

  ipcMain.handle('hostapi:fetch', async (_, request: HostApiFetchRequest) => {
    try {
      const path = typeof request?.path === 'string' ? request.path : '';
      if (!path || !path.startsWith('/')) {
        throw new Error(`Invalid host API path: ${String(request?.path)}`);
      }

      const method = (request.method || 'GET').toUpperCase();
      const headers: Record<string, string> = { ...(request.headers || {}) };
      // Inject the per-session auth token so the Host API server accepts this request.
      headers['Authorization'] = `Bearer ${getHostApiToken()}`;
      let body: string | undefined;

      if (request.body !== undefined && request.body !== null) {
        if (typeof request.body === 'string') {
          body = request.body;
        } else {
          body = JSON.stringify(request.body);
        }
        // Ensure Content-Type is set for requests with a body so the
        // server's anti-CSRF Content-Type gate does not reject them.
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      const response = await proxyAwareFetch(`http://127.0.0.1:${hostApiPort}${path}`, {
        method,
        headers,
        body,
      });

      const data: { status: number; ok: boolean; json?: unknown; text?: string } = {
        status: response.status,
        ok: response.ok,
      };

      if (response.status !== 204) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data.json = await response.json().catch(() => undefined);
        } else {
          data.text = await response.text().catch(() => '');
        }
      }

      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}
