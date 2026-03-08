import { invokeIpc } from '@/lib/api-client';

const HOST_API_PORT = 3210;
const HOST_API_BASE = `http://127.0.0.1:${HOST_API_PORT}`;

type HostApiProxyResponse = {
  ok?: boolean;
  data?: {
    status?: number;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
  error?: { message?: string } | string;
  // backward compatibility fields
  success: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // ignore body parse failure
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

export async function hostApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // In Electron renderer, always proxy through main process to avoid CORS.
  try {
    const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
      path,
      method: init?.method || 'GET',
      headers: headersToRecord(init?.headers),
      body: init?.body ?? null,
    });

    if (typeof response?.ok === 'boolean' && 'data' in response) {
      if (!response.ok) {
        const errObj = response.error;
        throw new Error(
          typeof errObj === 'string'
            ? errObj
            : (errObj?.message || 'Host API proxy request failed'),
        );
      }
      const data = response.data ?? {};
      if (data.status === 204) return undefined as T;
      if (data.json !== undefined) return data.json as T;
      return data.text as T;
    }

    if (!response?.success) {
      const errObj = response?.error;
      throw new Error(
        typeof errObj === 'string'
          ? errObj
          : (errObj?.message || 'Host API proxy request failed'),
      );
    }

    if (!response.ok) {
      const message = response.text
        || (typeof response.json === 'object' && response.json != null && 'error' in (response.json as Record<string, unknown>)
          ? String((response.json as Record<string, unknown>).error)
          : `HTTP ${response.status ?? 'unknown'}`);
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    if (response.json !== undefined) {
      return response.json as T;
    }

    return response.text as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes('Invalid IPC channel: hostapi:fetch')
      && !message.includes('window is not defined')
    ) {
      throw error;
    }
  }

  // Browser-only fallback (non-Electron environments).
  const response = await fetch(`${HOST_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return parseResponse<T>(response);
}

export function createHostEventSource(path = '/api/events'): EventSource {
  return new EventSource(`${HOST_API_BASE}${path}`);
}

export function getHostApiBase(): string {
  return HOST_API_BASE;
}
