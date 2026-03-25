import { ipcMain } from 'electron';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { PORTS } from '../../utils/config';

type HostApiFetchRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export function registerHostApiProxyHandlers(): void {
  ipcMain.handle('hostapi:fetch', async (_, request: HostApiFetchRequest) => {
    try {
      const path = typeof request?.path === 'string' ? request.path : '';
      if (!path || !path.startsWith('/')) {
        throw new Error(`Invalid host API path: ${String(request?.path)}`);
      }

      const method = (request.method || 'GET').toUpperCase();
      const headers: Record<string, string> = { ...(request.headers || {}) };
      let body: string | undefined;

      if (request.body !== undefined && request.body !== null) {
        if (typeof request.body === 'string') {
          body = request.body;
        } else {
          body = JSON.stringify(request.body);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
      }

      const response = await proxyAwareFetch(`http://127.0.0.1:${PORTS.CLAWX_HOST_API}${path}`, {
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
