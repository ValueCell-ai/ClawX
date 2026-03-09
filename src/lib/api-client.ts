export type AppErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PERMISSION'
  | 'NETWORK'
  | 'CONFIG'
  | 'GATEWAY'
  | 'UNKNOWN';

export type TransportKind = 'ipc' | 'ws' | 'http';
export type GatewayTransportPreference =
  | 'ws-first'
  | 'http-first'
  | 'ws-only'
  | 'http-only'
  | 'ipc-only';
type TransportInvoker = <T>(channel: string, args: unknown[]) => Promise<T>;
type TransportRequest = { channel: string; args: unknown[] };

type NormalizedTransportResponse = {
  ok: boolean;
  data?: unknown;
  error?: unknown;
};

type UnifiedRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

type UnifiedResponse = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type TransportRule = {
  matcher: string | RegExp;
  order: TransportKind[];
};

export type ApiClientTransportConfig = {
  enabled: Record<Exclude<TransportKind, 'ipc'>, boolean>;
  rules: TransportRule[];
};

const UNIFIED_CHANNELS = new Set<string>([
  'app:version',
  'app:name',
  'app:platform',
  'settings:getAll',
  'settings:get',
  'settings:set',
  'settings:setMany',
  'settings:reset',
  'provider:list',
  'provider:get',
  'provider:getDefault',
  'provider:hasApiKey',
  'provider:getApiKey',
  'provider:validateKey',
  'provider:listModels',
  'provider:autoSelectModel',
  'provider:save',
  'provider:delete',
  'provider:setApiKey',
  'provider:updateWithKey',
  'provider:deleteApiKey',
  'provider:setDefault',
  'update:status',
  'update:version',
  'update:check',
  'update:download',
  'update:install',
  'update:setChannel',
  'update:setAutoDownload',
  'update:cancelAutoInstall',
  'cron:list',
  'cron:create',
  'cron:update',
  'cron:delete',
  'cron:toggle',
  'cron:trigger',
  'usage:recentTokenHistory',
]);

const customInvokers = new Map<Exclude<TransportKind, 'ipc'>, TransportInvoker>();

let transportConfig: ApiClientTransportConfig = {
  enabled: {
    ws: false,
    http: false,
  },
  rules: [
    { matcher: /^gateway:rpc$/, order: ['ws', 'ipc'] },
    { matcher: /^gateway:/, order: ['ipc'] },
    { matcher: /.*/, order: ['ipc'] },
  ],
};

type GatewayStatusLike = {
  port?: unknown;
};

type HttpTransportOptions = {
  endpointResolver: () => Promise<string> | string;
  headers?: HeadersInit;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  buildRequest?: (request: TransportRequest) => {
    url?: string;
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
  };
  parseResponse?: (response: Response) => Promise<NormalizedTransportResponse>;
};

type WsTransportOptions = {
  urlResolver: () => Promise<string> | string;
  timeoutMs?: number;
  websocketFactory?: (url: string) => WebSocket;
  buildMessage?: (requestId: string, request: TransportRequest) => unknown;
  parseMessage?: (payload: unknown) => { id?: string; ok: boolean; data?: unknown; error?: unknown } | null;
};

type GatewayWsTransportOptions = {
  urlResolver?: () => Promise<string> | string;
  tokenResolver?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
  websocketFactory?: (url: string) => WebSocket;
};

let cachedGatewayPort: { port: number; expiresAt: number } | null = null;
const transportBackoffUntil: Partial<Record<Exclude<TransportKind, 'ipc'>, number>> = {};

async function resolveGatewayPort(): Promise<number> {
  const now = Date.now();
  if (cachedGatewayPort && cachedGatewayPort.expiresAt > now) {
    return cachedGatewayPort.port;
  }

  const status = await invokeViaIpc<GatewayStatusLike>('gateway:status', []);
  const port = typeof status?.port === 'number' && status.port > 0 ? status.port : 18789;
  cachedGatewayPort = { port, expiresAt: now + 5000 };
  return port;
}

export async function resolveDefaultGatewayHttpBaseUrl(): Promise<string> {
  const port = await resolveGatewayPort();
  return `http://127.0.0.1:${port}`;
}

export async function resolveDefaultGatewayWsUrl(): Promise<string> {
  const port = await resolveGatewayPort();
  return `ws://127.0.0.1:${port}/ws`;
}

class TransportUnsupportedError extends Error {
  transport: TransportKind;

  constructor(transport: TransportKind, message: string) {
    super(message);
    this.transport = transport;
  }
}

export class AppError extends Error {
  code: AppErrorCode;
  cause?: unknown;

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

function mapUnifiedErrorCode(code?: string): AppErrorCode {
  switch (code) {
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'PERMISSION':
      return 'PERMISSION';
    case 'GATEWAY':
      return 'GATEWAY';
    case 'VALIDATION':
      return 'CONFIG';
    case 'UNSUPPORTED':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

function normalizeError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('timeout')) {
    return new AppError('TIMEOUT', message, err);
  }
  if (lower.includes('rate limit')) {
    return new AppError('RATE_LIMIT', message, err);
  }
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('denied')) {
    return new AppError('PERMISSION', message, err);
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return new AppError('NETWORK', message, err);
  }
  if (lower.includes('gateway')) {
    return new AppError('GATEWAY', message, err);
  }
  if (lower.includes('config') || lower.includes('invalid')) {
    return new AppError('CONFIG', message, err);
  }

  return new AppError('UNKNOWN', message, err);
}

function isRuleMatch(matcher: string | RegExp, channel: string): boolean {
  if (typeof matcher === 'string') {
    if (matcher.endsWith('*')) {
      return channel.startsWith(matcher.slice(0, -1));
    }
    return matcher === channel;
  }
  return matcher.test(channel);
}

function resolveTransportOrder(channel: string): TransportKind[] {
  const now = Date.now();
  const matchedRule = transportConfig.rules.find((rule) => isRuleMatch(rule.matcher, channel));
  const order = matchedRule?.order ?? ['ipc'];

  return order.filter((kind) => {
    if (kind === 'ipc') return true;
    const backoffUntil = transportBackoffUntil[kind];
    if (typeof backoffUntil === 'number' && backoffUntil > now) {
      return false;
    }
    return transportConfig.enabled[kind];
  });
}

function markTransportFailure(kind: TransportKind): void {
  if (kind === 'ipc') return;
  transportBackoffUntil[kind] = Date.now() + 5000;
}

export function clearTransportBackoff(kind?: Exclude<TransportKind, 'ipc'>): void {
  if (kind) {
    delete transportBackoffUntil[kind];
    return;
  }
  delete transportBackoffUntil.ws;
  delete transportBackoffUntil.http;
}

function gatewayRulesForPreference(preference: GatewayTransportPreference): TransportRule[] {
  switch (preference) {
    case 'http-first':
      return [
        { matcher: /^gateway:rpc$/, order: ['http', 'ws', 'ipc'] },
        { matcher: /^gateway:/, order: ['ipc'] },
        { matcher: /.*/, order: ['ipc'] },
      ];
    case 'ws-only':
      return [
        { matcher: /^gateway:rpc$/, order: ['ws', 'ipc'] },
        { matcher: /^gateway:/, order: ['ipc'] },
        { matcher: /.*/, order: ['ipc'] },
      ];
    case 'http-only':
      return [
        { matcher: /^gateway:rpc$/, order: ['http', 'ipc'] },
        { matcher: /^gateway:/, order: ['ipc'] },
        { matcher: /.*/, order: ['ipc'] },
      ];
    case 'ipc-only':
      return [
        { matcher: /^gateway:rpc$/, order: ['ipc'] },
        { matcher: /^gateway:/, order: ['ipc'] },
        { matcher: /.*/, order: ['ipc'] },
      ];
    case 'ws-first':
    default:
      return [
        { matcher: /^gateway:rpc$/, order: ['ws', 'http', 'ipc'] },
        { matcher: /^gateway:/, order: ['ipc'] },
        { matcher: /.*/, order: ['ipc'] },
      ];
  }
}

export function applyGatewayTransportPreference(preference: GatewayTransportPreference): void {
  const enableWs = preference === 'ws-first' || preference === 'http-first' || preference === 'ws-only';
  const enableHttp = preference === 'ws-first' || preference === 'http-first' || preference === 'http-only';
  clearTransportBackoff();
  configureApiClient({
    enabled: {
      ws: enableWs,
      http: enableHttp,
    },
    rules: gatewayRulesForPreference(preference),
  });
}

function toUnifiedRequest(channel: string, args: unknown[]): UnifiedRequest {
  const splitIndex = channel.indexOf(':');
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    module: channel.slice(0, splitIndex),
    action: channel.slice(splitIndex + 1),
    payload: args.length <= 1 ? args[0] : args,
  };
}

async function invokeViaIpc<T>(channel: string, args: unknown[]): Promise<T> {
  if (channel !== 'app:request' && UNIFIED_CHANNELS.has(channel)) {
    const request = toUnifiedRequest(channel, args);

    try {
      const response = await window.electron.ipcRenderer.invoke('app:request', request) as UnifiedResponse;
      if (!response?.ok) {
        const message = response?.error?.message || 'Unified IPC request failed';
        if (message.includes('APP_REQUEST_UNSUPPORTED:')) {
          throw new Error(message);
        }
        throw new AppError(mapUnifiedErrorCode(response?.error?.code), message, response?.error);
      }
      return response.data as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('APP_REQUEST_UNSUPPORTED:') || message.includes('Invalid IPC channel: app:request')) {
        // Fallback to legacy channel handlers.
      } else {
        throw normalizeError(err);
      }
    }
  }

  try {
    return await window.electron.ipcRenderer.invoke(channel, ...args) as T;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function invokeViaTransport<T>(kind: TransportKind, channel: string, args: unknown[]): Promise<T> {
  if (kind === 'ipc') {
    return invokeViaIpc<T>(channel, args);
  }

  const invoker = customInvokers.get(kind);
  if (!invoker) {
    throw new TransportUnsupportedError(kind, `${kind.toUpperCase()} transport invoker is not registered`);
  }
  return invoker<T>(channel, args);
}

export function configureApiClient(next: Partial<ApiClientTransportConfig>): void {
  transportConfig = {
    enabled: {
      ...transportConfig.enabled,
      ...(next.enabled ?? {}),
    },
    rules: next.rules ?? transportConfig.rules,
  };
}

export function getApiClientConfig(): ApiClientTransportConfig {
  return {
    enabled: { ...transportConfig.enabled },
    rules: [...transportConfig.rules],
  };
}

export function registerTransportInvoker(kind: Exclude<TransportKind, 'ipc'>, invoker: TransportInvoker): void {
  customInvokers.set(kind, invoker);
}

export function unregisterTransportInvoker(kind: Exclude<TransportKind, 'ipc'>): void {
  customInvokers.delete(kind);
}

export function createHttpTransportInvoker(options: HttpTransportOptions): TransportInvoker {
  const timeoutMs = options.timeoutMs ?? 15000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async <T>(channel: string, args: unknown[]): Promise<T> => {
    const baseUrl = await Promise.resolve(options.endpointResolver());
    if (!baseUrl) {
      throw new Error('HTTP transport endpoint is empty');
    }

    const request = { channel, args };
    const built = options.buildRequest?.(request);
    const url = built?.url ?? `${baseUrl.replace(/\/$/, '')}/rpc`;
    const method = built?.method ?? 'POST';
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...(built?.headers ?? {}),
    };
    const body = built?.body ?? JSON.stringify(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const parsed = options.parseResponse
        ? await options.parseResponse(response)
        : await response.json() as NormalizedTransportResponse;

      if (!parsed?.ok) {
        throw new Error(String(parsed?.error ?? 'HTTP transport request failed'));
      }
      return parsed.data as T;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createWsTransportInvoker(options: WsTransportOptions): TransportInvoker {
  const timeoutMs = options.timeoutMs ?? 15000;
  const websocketFactory = options.websocketFactory ?? ((url: string) => new WebSocket(url));
  let socket: WebSocket | null = null;
  let connectPromise: Promise<WebSocket> | null = null;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

  const clearPending = (error: Error) => {
    for (const [id, item] of pending.entries()) {
      clearTimeout(item.timer);
      item.reject(error);
      pending.delete(id);
    }
  };

  const ensureConnection = async (): Promise<WebSocket> => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return socket;
    }
    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = (async () => {
      const url = await Promise.resolve(options.urlResolver());
      if (!url) {
        throw new Error('WS transport URL is empty');
      }
      const ws = websocketFactory(url);

      return await new Promise<WebSocket>((resolve, reject) => {
        const cleanup = () => {
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);
        };
        const onOpen = () => {
          cleanup();
          resolve(ws);
        };
        const onError = (event: Event) => {
          cleanup();
          reject(new Error(`WS transport connection failed: ${String(event.type)}`));
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
      });
    })();

    try {
      socket = await connectPromise;
      socket.addEventListener('message', (event) => {
        try {
          const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          const parsed = options.parseMessage
            ? options.parseMessage(raw)
            : (raw as { id?: string; ok: boolean; data?: unknown; error?: unknown });

          if (!parsed?.id) return;
          const item = pending.get(parsed.id);
          if (!item) return;

          clearTimeout(item.timer);
          pending.delete(parsed.id);

          if (parsed.ok) {
            item.resolve(parsed.data);
          } else {
            item.reject(new Error(String(parsed.error ?? 'WS transport request failed')));
          }
        } catch {
          // ignore malformed event payloads
        }
      });
      socket.addEventListener('close', () => {
        socket = null;
        clearPending(new Error('WS transport closed'));
      });
      socket.addEventListener('error', () => {
        socket = null;
      });
      return socket;
    } finally {
      connectPromise = null;
    }
  };

  return async <T>(channel: string, args: unknown[]): Promise<T> => {
    const ws = await ensureConnection();
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const message = options.buildMessage
      ? options.buildMessage(requestId, { channel, args })
      : { id: requestId, channel, args };

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('WS transport timeout'));
      }, timeoutMs);

      pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(err);
      }
    });
  };
}

export function createGatewayHttpTransportInvoker(
  _endpointResolver: () => Promise<string> | string = resolveDefaultGatewayHttpBaseUrl,
): TransportInvoker {
  return async <T>(channel: string, args: unknown[]): Promise<T> => {
    if (channel !== 'gateway:rpc') {
      throw new Error(`HTTP gateway transport does not support channel: ${channel}`);
    }
    const [method, params, timeoutOverride] = args;
    if (typeof method !== 'string') {
      throw new Error('gateway:rpc requires method string');
    }

    const timeoutMs =
      typeof timeoutOverride === 'number' && timeoutOverride > 0
        ? timeoutOverride
        : 15000;

    const response = await invokeViaIpc<{
      success: boolean;
      status?: number;
      ok?: boolean;
      json?: unknown;
      text?: string;
      error?: string;
    }>('gateway:httpProxy', [{
      path: '/rpc',
      method: 'POST',
      timeoutMs,
      body: {
        type: 'req',
        method,
        params,
      },
    }]);

    if (!response?.success) {
      throw new Error(response?.error || 'Gateway HTTP proxy failed');
    }

    const payload = response?.json as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
      throw new Error(response?.text || `Gateway HTTP returned non-JSON (status=${response?.status ?? 'unknown'})`);
    }

    if (payload.type === 'res') {
      if (payload.ok === false || payload.error) {
        throw new Error(String(payload.error ?? 'Gateway HTTP request failed'));
      }
      return (payload.payload ?? payload) as T;
    }
    if ('ok' in payload) {
      if (!payload.ok) {
        throw new Error(String(payload.error ?? 'Gateway HTTP request failed'));
      }
      return (payload.data ?? payload) as T;
    }

    return payload as T;
  };
}

export function createGatewayWsTransportInvoker(options: GatewayWsTransportOptions = {}): TransportInvoker {
  const timeoutMs = options.timeoutMs ?? 15000;
  const websocketFactory = options.websocketFactory ?? ((url: string) => new WebSocket(url));
  const resolveUrl = options.urlResolver ?? resolveDefaultGatewayWsUrl;
  const resolveToken = options.tokenResolver ?? (() => invokeViaIpc<string | null>('settings:get', ['gatewayToken']));

  let socket: WebSocket | null = null;
  let connectPromise: Promise<WebSocket> | null = null;
  let handshakeDone = false;
  let connectRequestId: string | null = null;

  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const clearPending = (error: Error) => {
    for (const [id, item] of pending.entries()) {
      clearTimeout(item.timer);
      item.reject(error);
      pending.delete(id);
    }
  };

  const sendConnect = async (_challengeNonce: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway WS not open during connect handshake');
    }
    const token = await Promise.resolve(resolveToken());
    connectRequestId = `connect-${Date.now()}`;
    socket.send(JSON.stringify({
      type: 'req',
      id: connectRequestId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'clawx-ui',
          displayName: 'ClawX UI',
          version: '0.1.0',
          platform: window.electron?.platform ?? 'unknown',
          mode: 'ui',
        },
        auth: {
          token: token ?? null,
        },
        caps: [],
        role: 'operator',
        scopes: ['operator.admin'],
      },
    }));
  };

  const ensureConnection = async (): Promise<WebSocket> => {
    if (socket && socket.readyState === WebSocket.OPEN && handshakeDone) {
      return socket;
    }
    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = (async () => {
      const url = await Promise.resolve(resolveUrl());
      if (!url) {
        throw new Error('Gateway WS URL is empty');
      }
      const ws = websocketFactory(url);
      socket = ws;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Gateway WS connect timeout'));
        }, timeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          ws.removeEventListener('open', onOpen);
          ws.removeEventListener('error', onError);
        };

        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Gateway WS open failed'));
        };

        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Gateway WS handshake timeout'));
        }, timeoutMs);

        const cleanup = () => {
          clearTimeout(timer);
          ws.removeEventListener('message', onHandshakeMessage);
        };

        const onHandshakeMessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
            if (msg.type === 'event' && msg.event === 'connect.challenge') {
              const payload = (msg.payload ?? {}) as Record<string, unknown>;
              const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
              if (!nonce) {
                cleanup();
                reject(new Error('Gateway WS challenge nonce missing'));
                return;
              }
              void sendConnect(nonce).catch((err) => {
                cleanup();
                reject(err);
              });
              return;
            }

            if (msg.type === 'res' && typeof msg.id === 'string' && msg.id === connectRequestId) {
              const ok = msg.ok !== false && !msg.error;
              if (!ok) {
                cleanup();
                reject(new Error(`Gateway WS connect failed: ${String(msg.error ?? 'unknown')}`));
                return;
              }
              handshakeDone = true;
              cleanup();
              resolve();
            }
          } catch {
            // ignore parse errors during handshake
          }
        };

        ws.addEventListener('message', onHandshakeMessage);
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.type !== 'res' || typeof msg.id !== 'string') return;
          const item = pending.get(msg.id);
          if (!item) return;

          clearTimeout(item.timer);
          pending.delete(msg.id);

          const ok = msg.ok !== false && !msg.error;
          if (!ok) {
            item.reject(new Error(String(msg.error ?? 'Gateway WS request failed')));
            return;
          }
          item.resolve(msg.payload ?? msg);
        } catch {
          // ignore malformed payload
        }
      });
      ws.addEventListener('close', () => {
        socket = null;
        handshakeDone = false;
        connectRequestId = null;
        clearPending(new Error('Gateway WS closed'));
      });
      ws.addEventListener('error', () => {
        socket = null;
        handshakeDone = false;
      });

      return ws;
    })();

    try {
      return await connectPromise;
    } finally {
      connectPromise = null;
    }
  };

  return async <T>(channel: string, args: unknown[]): Promise<T> => {
    if (channel !== 'gateway:rpc') {
      throw new Error(`Gateway WS transport does not support channel: ${channel}`);
    }
    const [method, params, timeoutOverride] = args;
    if (typeof method !== 'string') {
      throw new Error('gateway:rpc requires method string');
    }

    const requestTimeoutMs =
      typeof timeoutOverride === 'number' && timeoutOverride > 0
        ? timeoutOverride
        : timeoutMs;

    const ws = await ensureConnection();
    const requestId = crypto.randomUUID();
    ws.send(JSON.stringify({
      type: 'req',
      id: requestId,
      method,
      params,
    }));

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Gateway WS timeout: ${method}`));
      }, requestTimeoutMs);

      pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });
  };
}

let defaultTransportsInitialized = false;

export function initializeDefaultTransports(): void {
  if (defaultTransportsInitialized) return;
  registerTransportInvoker('ws', createGatewayWsTransportInvoker());
  registerTransportInvoker('http', createGatewayHttpTransportInvoker());
  applyGatewayTransportPreference('ws-first');
  defaultTransportsInitialized = true;
}

export function toUserMessage(error: unknown): string {
  const appError = error instanceof AppError ? error : normalizeError(error);

  switch (appError.code) {
    case 'TIMEOUT':
      return 'Request timed out. Please retry.';
    case 'RATE_LIMIT':
      return 'Too many requests. Please wait and try again.';
    case 'PERMISSION':
      return 'Permission denied. Check your configuration and retry.';
    case 'NETWORK':
      return 'Network error. Please verify connectivity and retry.';
    case 'CONFIG':
      return 'Configuration is invalid. Please review settings.';
    case 'GATEWAY':
      return 'Gateway is unavailable. Start or restart the gateway and retry.';
    default:
      return appError.message || 'Unexpected error occurred.';
  }
}

export async function invokeApi<T>(channel: string, ...args: unknown[]): Promise<T> {
  const order = resolveTransportOrder(channel);
  let lastError: unknown;

  for (const kind of order) {
    try {
      return await invokeViaTransport<T>(kind, channel, args);
    } catch (err) {
      if (err instanceof TransportUnsupportedError) {
        markTransportFailure(kind);
        lastError = err;
        continue;
      }
      lastError = err;
      // For non-IPC transports, fail open to the next transport.
      if (kind !== 'ipc') {
        markTransportFailure(kind);
        continue;
      }
      throw err;
    }
  }

  throw normalizeError(lastError);
}

export async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  return invokeApi<T>(channel, ...args);
}

export async function invokeIpcWithRetry<T>(
  channel: string,
  args: unknown[] = [],
  retries = 1,
  retryable: AppErrorCode[] = ['TIMEOUT', 'NETWORK'],
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await invokeApi<T>(channel, ...args);
    } catch (err) {
      lastError = err;
      if (!(err instanceof AppError) || !retryable.includes(err.code) || i === retries) {
        throw err;
      }
    }
  }

  throw normalizeError(lastError);
}
