# Remove Host API Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX's local Host API HTTP server and Renderer Gateway transports with a typed Electron IPC facade, leaving OpenClaw Gateway RPC centralized in Main.

**Architecture:** Renderer feature code calls `hostApi.<module>.<action>()`; the facade sends typed module/action requests through one preload bridge to a Main dispatcher. Main dispatches to service modules and Gateway RPC flows only through `GatewayManager.rpc()` over the Main-owned WebSocket.

**Tech Stack:** Electron Main/Preload IPC, React 19, TypeScript, Vite, Zustand, Vitest, Playwright Electron E2E, pnpm.

---

## File Structure

Create these files:

- `electron/main/ipc/host-contract.ts` - shared Main-side request/response contract, module/action typing, and validation helpers.
- `electron/main/ipc/host-invoke.ts` - registers the private `host:invoke` handler and dispatches typed requests.
- `electron/services/settings-api.ts` - typed settings service functions that wrap `electron/utils/store.ts`.
- `electron/services/gateway-api.ts` - typed Gateway lifecycle, health, control UI, and RPC service functions.
- `electron/services/logs-api.ts` - typed log read/list/path service functions.
- `electron/services/channels-api.ts` - typed channel configuration and account/binding service functions.
- `electron/services/agents-api.ts` - typed agent listing and mutation service functions.
- `electron/services/diagnostics-api.ts` - typed diagnostics snapshot service functions.
- `electron/services/providers-api.ts` - typed provider and provider-account service functions.
- `electron/services/cron-api.ts` - typed cron service functions that call `GatewayManager.rpc()`.
- `electron/services/files-api.ts` - typed file staging and preview service functions.
- `electron/services/media-api.ts` - typed media thumbnail/image-generation service functions.
- `electron/services/sessions-api.ts` - typed session delete/rename/summaries/history service functions.
- `electron/services/skills-api.ts` - typed skill config and ClawHub service functions.
- `electron/services/usage-api.ts` - typed usage-history service functions.
- `electron/gateway/ws-trace.ts` - Main-side Gateway WebSocket trace redaction and summary helpers.
- `src/lib/host-api-client.ts` - private client that calls `window.clawx.hostInvoke`.
- `src/lib/host-api-types.ts` - Renderer request/response and payload/result types.
- `src/lib/host-events.ts` - convert from generic `subscribeHostEvent()` API to typed event methods.
- `tests/unit/host-invoke.test.ts` - Main dispatcher tests.
- `tests/unit/host-api-facade.test.ts` - Renderer facade tests.
- `tests/unit/gateway-ws-trace.test.ts` - redaction and summary tests.

Modify these files:

- `electron/preload/index.ts` - expose `window.clawx.hostInvoke` and remove `hostapi:*` and `gateway:httpProxy` allowlist entries.
- `electron/main/ipc-handlers.ts` - register `host:invoke`; keep non-business legacy IPC only until migrated; remove `gateway:httpProxy`.
- `electron/main/index.ts` - stop starting Host API server and remove `HostEventBus` wiring.
- `electron/extensions/types.ts`, `electron/extensions/registry.ts`, and builtin extensions - remove HTTP route handler extension point.
- `electron/gateway/manager.ts` and `electron/gateway/ws-client.ts` - add optional trace hooks without changing protocol behavior.
- `src/lib/api-client.ts` - remove WS/HTTP Gateway transport and diagnostic preference logic; keep only the small legacy IPC helper needed by non-business calls.
- `src/lib/host-api.ts` - keep as the public renderer facade entrypoint; during migration it exports both new `hostApi.<module>.<action>()` methods and legacy `hostApiFetch()` until all call sites are moved.
- `src/stores/*.ts`, `src/stores/chat/*.ts`, `src/pages/**/*.tsx`, `src/components/**/*.tsx`, and `src/lib/*.ts` call sites - replace `hostApiFetch()` and direct `gateway:rpc` usage with `hostApi`.
- `src/pages/Settings/index.tsx` and locale files under `src/i18n/locales/*/settings.json` - remove WS Diagnostic Mode UI and strings.
- `README.md`, `README.zh-CN.md`, `README.ja-JP.md` - update architecture docs.
- `harness/specs/scenarios/gateway-backend-communication.md` and related rules - replace Host API fallback rules with typed IPC rules.

Delete these files after migrations compile:

- `electron/api/server.ts`
- `electron/api/context.ts`
- `electron/api/event-bus.ts`
- `electron/api/route-utils.ts`
- `electron/api/routes/*.ts`
- `electron/main/ipc/host-api-proxy.ts`
- `src/lib/gateway-client.ts`

## Task 1: Add Typed Host Invoke Contract And Preload Bridge

**Files:**
- Create: `electron/main/ipc/host-contract.ts`
- Create: `electron/main/ipc/host-invoke.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/types/electron.d.ts`
- Test: `tests/unit/host-invoke.test.ts`

- [ ] **Step 1: Write failing dispatcher contract tests**

Create `tests/unit/host-invoke.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createHostInvokeDispatcher } from '../electron/main/ipc/host-invoke';

describe('host invoke dispatcher', () => {
  it('dispatches a typed request to the matching service action', async () => {
    const services = {
      settings: {
        getAll: vi.fn(async () => ({ theme: 'dark' })),
      },
    };
    const dispatch = createHostInvokeDispatcher(services);

    await expect(dispatch({
      id: 'req-1',
      module: 'settings',
      action: 'getAll',
    })).resolves.toEqual({
      id: 'req-1',
      ok: true,
      data: { theme: 'dark' },
    });

    expect(services.settings.getAll).toHaveBeenCalledWith(undefined);
  });

  it('returns a validation error for malformed requests', async () => {
    const dispatch = createHostInvokeDispatcher({});

    await expect(dispatch({ id: 'bad', module: '', action: 'getAll' })).resolves.toMatchObject({
      id: 'bad',
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('returns unsupported for unknown module/action pairs', async () => {
    const dispatch = createHostInvokeDispatcher({ settings: {} });

    await expect(dispatch({
      id: 'req-2',
      module: 'settings',
      action: 'missing',
    })).resolves.toMatchObject({
      id: 'req-2',
      ok: false,
      error: { code: 'UNSUPPORTED' },
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm exec vitest run tests/unit/host-invoke.test.ts
```

Expected: fail because `electron/main/ipc/host-invoke.ts` does not exist.

- [ ] **Step 3: Add host invoke contract**

Create `electron/main/ipc/host-contract.ts`:

```ts
export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type HostErrorCode = 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL';

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error: { code: HostErrorCode; message: string; details?: unknown } };

export type HostServiceAction = (payload?: unknown) => Promise<unknown> | unknown;
export type HostServiceRegistry = Record<string, Record<string, HostServiceAction>>;

export function isHostRequest(value: unknown): value is HostRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.module === 'string'
    && record.module.length > 0
    && typeof record.action === 'string'
    && record.action.length > 0;
}
```

- [ ] **Step 4: Add dispatcher and IPC registration**

Create `electron/main/ipc/host-invoke.ts`:

```ts
import { ipcMain } from 'electron';
import {
  type HostRequest,
  type HostResponse,
  type HostServiceRegistry,
  isHostRequest,
} from './host-contract';

export function createHostInvokeDispatcher(services: HostServiceRegistry) {
  return async function dispatchHostRequest(request: unknown): Promise<HostResponse> {
    const requestId = request && typeof request === 'object'
      ? String((request as Record<string, unknown>).id ?? '')
      : undefined;

    if (!isHostRequest(request)) {
      return {
        id: requestId,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid host request format' },
      };
    }

    const moduleActions = services[request.module];
    const action = moduleActions?.[request.action];
    if (!action) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'UNSUPPORTED',
          message: `Unsupported host request: ${request.module}.${request.action}`,
        },
      };
    }

    try {
      const data = await action(request.payload);
      return { id: request.id, ok: true, data };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };
}

export function registerHostInvokeHandler(services: HostServiceRegistry): void {
  const dispatch = createHostInvokeDispatcher(services);
  ipcMain.handle('host:invoke', async (_event, request: HostRequest) => dispatch(request));
}
```

- [ ] **Step 5: Expose preload bridge**

Modify `electron/preload/index.ts` so `contextBridge.exposeInMainWorld` also exposes a `clawx` object:

```ts
const clawxAPI = {
  hostInvoke: (request: unknown) => ipcRenderer.invoke('host:invoke', request),
};

contextBridge.exposeInMainWorld('clawx', clawxAPI);
```

Keep the existing `window.electron` bridge during migration. Add `'host:invoke'` to the internal invoke allowlist only if `hostInvoke` reuses that allowlist; prefer a dedicated `clawxAPI.hostInvoke` method so feature code never sees the channel.

- [ ] **Step 6: Update renderer global types**

Modify `src/types/electron.d.ts`:

```ts
export {};

declare global {
  interface Window {
    clawx?: {
      hostInvoke: <T = unknown>(request: {
        id: string;
        module: string;
        action: string;
        payload?: unknown;
      }) => Promise<T>;
    };
  }
}
```

Merge this with the existing declarations in the file instead of replacing unrelated `window.electron` types.

- [ ] **Step 7: Verify contract tests pass**

Run:

```bash
pnpm exec vitest run tests/unit/host-invoke.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add electron/main/ipc/host-contract.ts electron/main/ipc/host-invoke.ts electron/preload/index.ts src/types/electron.d.ts tests/unit/host-invoke.test.ts
git commit -m "feat(ipc): add typed host invoke bridge"
```

## Task 2: Add Renderer hostApi Facade And First Services

**Files:**
- Create: `src/lib/host-api-client.ts`
- Create: `src/lib/host-api-types.ts`
- Modify: `src/lib/host-api.ts`
- Create: `electron/services/settings-api.ts`
- Create: `electron/services/gateway-api.ts`
- Create: `electron/services/logs-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Test: `tests/unit/host-api-facade.test.ts`
- Test: `tests/unit/host-invoke.test.ts`

- [ ] **Step 1: Write failing facade tests**

Create `tests/unit/host-api-facade.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostInvoke = vi.fn();

beforeEach(() => {
  hostInvoke.mockReset();
  vi.stubGlobal('window', {
    clawx: { hostInvoke },
  });
});

describe('hostApi facade', () => {
  it('calls settings.getAll through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { theme: 'dark' } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).resolves.toEqual({ theme: 'dark' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'settings',
      action: 'getAll',
    }));
  });

  it('throws response errors', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: false,
      error: { code: 'INTERNAL', message: 'disk failed' },
    });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).rejects.toThrow('disk failed');
  });
});
```

- [ ] **Step 2: Run the failing facade test**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts
```

Expected: fail because `hostApi.settings.getAll()` is not implemented yet in `src/lib/host-api.ts`.

- [ ] **Step 3: Implement private renderer client**

Create `src/lib/host-api-types.ts`:

```ts
export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error?: { code?: string; message?: string; details?: unknown } };
```

Create `src/lib/host-api-client.ts`:

```ts
import type { HostRequest, HostResponse } from './host-api-types';

function createRequest(module: string, action: string, payload?: unknown): HostRequest {
  return {
    id: crypto.randomUUID(),
    module,
    action,
    ...(payload === undefined ? {} : { payload }),
  };
}

export async function invokeHost<T>(module: string, action: string, payload?: unknown): Promise<T> {
  const bridge = window.clawx?.hostInvoke;
  if (!bridge) {
    throw new Error('Host invoke bridge is unavailable');
  }

  const response = await bridge<HostResponse<T>>(createRequest(module, action, payload));
  if (!response?.ok) {
    throw new Error(response?.error?.message || `Host request failed: ${module}.${action}`);
  }
  return response.data;
}
```

- [ ] **Step 4: Implement first renderer modules**

Modify `src/lib/host-api.ts` to add the typed facade below while temporarily keeping the existing `hostApiFetch()` exports for unmigrated call sites:

```ts
import { invokeHost } from './host-api-client';

export const hostApi = {
  settings: {
    getAll: <T = Record<string, unknown>>() => invokeHost<T>('settings', 'getAll'),
    get: <T = unknown>(key: string) => invokeHost<T>('settings', 'get', { key }),
    set: (key: string, value: unknown) => invokeHost<{ success: boolean }>('settings', 'set', { key, value }),
  },
  gateway: {
    status: <T = unknown>() => invokeHost<T>('gateway', 'status'),
    start: () => invokeHost<{ success: boolean }>('gateway', 'start'),
    stop: () => invokeHost<{ success: boolean }>('gateway', 'stop'),
    restart: () => invokeHost<{ success: boolean }>('gateway', 'restart'),
    health: <T = unknown>(probe = false) => invokeHost<T>('gateway', 'health', { probe }),
    controlUi: <T = unknown>(view?: 'dreams') => invokeHost<T>('gateway', 'controlUi', { view }),
    rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => (
      invokeHost<T>('gateway', 'rpc', { method, params, timeoutMs })
    ),
  },
  logs: {
    recent: (tailLines = 100) => invokeHost<{ content: string }>('logs', 'recent', { tailLines }),
    dir: () => invokeHost<{ dir: string | null }>('logs', 'dir'),
    listFiles: <T = unknown>() => invokeHost<T>('logs', 'listFiles'),
    readFile: (path: string) => invokeHost<{ content: string }>('logs', 'readFile', { path }),
  },
};

export type HostApi = typeof hostApi;
```

- [ ] **Step 5: Implement first Main services**

Create `electron/services/settings-api.ts`:

```ts
import { getAllSettings, getSetting, setSetting } from '../utils/store';

export function createSettingsApi() {
  return {
    getAll: async () => await getAllSettings(),
    get: async (payload?: unknown) => {
      const key = (payload as { key?: string } | undefined)?.key;
      if (!key) throw new Error('settings.get requires key');
      return await getSetting(key as never);
    },
    set: async (payload?: unknown) => {
      const input = payload as { key?: string; value?: unknown } | undefined;
      if (!input?.key) throw new Error('settings.set requires key');
      await setSetting(input.key as never, input.value as never);
      return { success: true };
    },
  };
}
```

Create `electron/services/gateway-api.ts`:

```ts
import type { GatewayManager } from '../gateway/manager';
import { PORTS } from '../utils/config';
import { getSetting } from '../utils/store';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { scheduleControlUiDeviceAutoApproval } from '../utils/control-ui-device-pairing';

export function createGatewayApi(gatewayManager: GatewayManager) {
  return {
    status: async () => gatewayManager.getStatus(),
    start: async () => {
      await gatewayManager.start();
      return { success: true };
    },
    stop: async () => {
      await gatewayManager.stop();
      return { success: true };
    },
    restart: async () => {
      await gatewayManager.restart();
      return { success: true };
    },
    health: async (payload?: unknown) => {
      const probe = (payload as { probe?: boolean } | undefined)?.probe === true;
      return await gatewayManager.checkHealth({ probe });
    },
    controlUi: async (payload?: unknown) => {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const view = (payload as { view?: string } | undefined)?.view === 'dreams' ? 'dreams' : undefined;
      scheduleControlUiDeviceAutoApproval(gatewayManager);
      return { success: true, url: buildOpenClawControlUiUrl(port, token, { view }), token, port };
    },
    rpc: async (payload?: unknown) => {
      const input = payload as { method?: string; params?: unknown; timeoutMs?: number } | undefined;
      if (!input?.method) throw new Error('gateway.rpc requires method');
      return await gatewayManager.rpc(input.method, input.params, input.timeoutMs);
    },
  };
}
```

Create `electron/services/logs-api.ts`:

```ts
import { logger } from '../utils/logger';

export function createLogsApi() {
  return {
    recent: async (payload?: unknown) => {
      const tailLines = (payload as { tailLines?: number } | undefined)?.tailLines ?? 100;
      return { content: await logger.readLogFile(Number.isFinite(tailLines) ? tailLines : 100) };
    },
    memory: async (payload?: unknown) => {
      const count = (payload as { count?: number } | undefined)?.count;
      return logger.getRecentLogs(count);
    },
    dir: async () => ({ dir: logger.getLogDir() }),
    filePath: async () => ({ path: logger.getLogFilePath() }),
    listFiles: async () => ({ files: await logger.listLogFiles() }),
    readFile: async (payload?: unknown) => {
      const tailLines = (payload as { tailLines?: number } | undefined)?.tailLines ?? 200;
      return { content: await logger.readLogFile(Number.isFinite(tailLines) ? tailLines : 200) };
    },
  };
}
```

- [ ] **Step 6: Register first services**

Modify `electron/main/ipc-handlers.ts` near the existing handler registration:

```ts
import { registerHostInvokeHandler } from './ipc/host-invoke';
import { createSettingsApi } from '../services/settings-api';
import { createGatewayApi } from '../services/gateway-api';
import { createLogsApi } from '../services/logs-api';

function registerTypedHostHandlers(gatewayManager: GatewayManager): void {
  registerHostInvokeHandler({
    settings: createSettingsApi(),
    gateway: createGatewayApi(gatewayManager),
    logs: createLogsApi(),
  });
}
```

Call `registerTypedHostHandlers(gatewayManager)` from `registerIpcHandlers()` before feature handlers.

- [ ] **Step 7: Verify tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts
pnpm run typecheck
```

Expected: both Vitest files pass; typecheck passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts electron/services/settings-api.ts electron/services/gateway-api.ts electron/services/logs-api.ts electron/main/ipc-handlers.ts tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts
git commit -m "feat(host-api): add typed facade and core services"
```

## Task 3: Migrate Settings, Gateway, And Logs Call Sites

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/gateway.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/pages/Setup/index.tsx`
- Modify: `src/pages/Dreams/index.tsx`
- Test: `tests/unit/stores.test.ts`
- Test: `tests/unit/gateway-events.test.ts`

- [ ] **Step 1: Update tests to mock typed facade**

In tests that currently mock `@/lib/host-api`, replace `hostApiFetch` mocks with a `hostApi` object. For example, update `tests/unit/gateway-events.test.ts`:

```ts
const hostApiMock = vi.hoisted(() => ({
  gateway: {
    status: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    health: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));
```

Use `hostApiMock.gateway.status.mockResolvedValue({ state: 'running', port: 18789 })` where the test previously resolved `hostApiFetch('/api/gateway/status')`.

- [ ] **Step 2: Run updated tests to confirm failing production imports**

Run:

```bash
pnpm exec vitest run tests/unit/stores.test.ts tests/unit/gateway-events.test.ts
```

Expected: fail because stores still import `hostApiFetch` or call direct `gateway:rpc`.

- [ ] **Step 3: Migrate settings store**

Modify `src/stores/settings.ts`:

```ts
import { hostApi } from '@/lib/host-api';
```

Replace reads:

```ts
const settings = await hostApi.settings.getAll<Partial<typeof defaultSettings>>();
```

Replace writes:

```ts
void hostApi.settings.set('theme', theme);
void hostApi.settings.set('language', language);
void hostApi.settings.set('launchAtStartup', launchAtStartup);
void hostApi.settings.set('telemetryEnabled', telemetryEnabled);
void hostApi.settings.set('gatewayAutoStart', gatewayAutoStart);
void hostApi.settings.set('gatewayPort', gatewayPort);
void hostApi.settings.set('autoCheckUpdate', autoCheckUpdate);
void hostApi.settings.set('devModeUnlocked', devModeUnlocked);
```

- [ ] **Step 4: Migrate gateway store**

Modify `src/stores/gateway.ts`:

```ts
import { hostApi } from '@/lib/host-api';
```

Replace status/start/stop/restart/health/RPC calls:

```ts
const status = await hostApi.gateway.status<GatewayStatus>();
const result = await hostApi.gateway.start();
await hostApi.gateway.stop();
const restartResult = await hostApi.gateway.restart();
const health = await hostApi.gateway.health<GatewayHealth>();
const response = await hostApi.gateway.rpc<T>(method, params, timeoutMs);
```

Keep the existing state transitions and error handling.

- [ ] **Step 5: Migrate Settings, Setup, and Dreams pages**

Replace `hostApiFetch` calls:

```ts
const logs = await hostApi.logs.recent(100);
const { dir: logDir } = await hostApi.logs.dir();
const result = await hostApi.gateway.controlUi();
const dreams = await hostApi.gateway.controlUi('dreams');
await hostApi.gateway.restart();
```

Update imports in:

- `src/pages/Settings/index.tsx`
- `src/pages/Setup/index.tsx`
- `src/pages/Dreams/index.tsx`

- [ ] **Step 6: Verify migrated tests**

Run:

```bash
pnpm exec vitest run tests/unit/stores.test.ts tests/unit/gateway-events.test.ts tests/unit/dreams-page.test.tsx
pnpm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add src/stores/settings.ts src/stores/gateway.ts src/pages/Settings/index.tsx src/pages/Setup/index.tsx src/pages/Dreams/index.tsx tests/unit/stores.test.ts tests/unit/gateway-events.test.ts tests/unit/dreams-page.test.tsx
git commit -m "refactor(renderer): migrate settings and gateway to typed host api"
```

## Task 4: Migrate Channels, Agents, And Diagnostics

**Files:**
- Create: `electron/services/channels-api.ts`
- Create: `electron/services/agents-api.ts`
- Create: `electron/services/diagnostics-api.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/pages/Channels/index.tsx`
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/components/channels/ChannelConfigModal.tsx`
- Modify: `src/stores/channels.ts`
- Test: `tests/unit/channels-page.test.tsx`
- Test: `tests/unit/agents-page.test.tsx`

- [ ] **Step 1: Write channel facade test cases**

Extend `tests/unit/host-api-facade.test.ts`:

```ts
it('calls channels.accounts through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, channels: [] } });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.channels.accounts();
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'channels',
    action: 'accounts',
  }));
});

it('calls agents.list through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, agents: [] } });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.agents.list();
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'agents',
    action: 'list',
  }));
});
```

- [ ] **Step 2: Implement channel, agent, diagnostics services**

Move logic from these route files into service modules:

- `electron/api/routes/channels.ts` -> `electron/services/channels-api.ts`
- `electron/api/routes/agents.ts` -> `electron/services/agents-api.ts`
- `electron/api/routes/diagnostics.ts` -> `electron/services/diagnostics-api.ts`

The service API should use explicit actions:

```ts
export function createChannelsApi(deps: { gatewayManager: GatewayManager; mainWindow: BrowserWindow }) {
  return {
    accounts: async () => await listChannelAccounts(),
    configured: async () => await listConfiguredChannels(),
    saveConfig: async (payload?: unknown) => await saveChannelConfigFromPayload(payload),
    deleteConfig: async (payload?: unknown) => await deleteChannelConfigFromPayload(payload),
    bindingSave: async (payload?: unknown) => await saveBindingFromPayload(payload),
    bindingDelete: async (payload?: unknown) => await deleteBindingFromPayload(payload),
    startLogin: async (payload?: unknown) => await startChannelLoginFromPayload(payload, deps.mainWindow),
    cancelLogin: async (payload?: unknown) => await cancelChannelLoginFromPayload(payload),
  };
}
```

Use the exact lower-level utility functions already imported by the route files.

- [ ] **Step 3: Register services**

Add to `registerTypedHostHandlers()`:

```ts
channels: createChannelsApi({ gatewayManager, mainWindow }),
agents: createAgentsApi({ gatewayManager }),
diagnostics: createDiagnosticsApi({ gatewayManager }),
```

Pass `mainWindow` into the helper if channel QR/login handlers need it.

- [ ] **Step 4: Extend renderer facade**

Add:

```ts
channels: {
  accounts: <T = unknown>() => invokeHost<T>('channels', 'accounts'),
  configured: <T = unknown>() => invokeHost<T>('channels', 'configured'),
  formValues: <T = unknown>(channelType: string, accountId?: string) => invokeHost<T>('channels', 'formValues', { channelType, accountId }),
  saveConfig: <T = unknown>(input: unknown) => invokeHost<T>('channels', 'saveConfig', input),
  deleteConfig: <T = unknown>(channelType: string, accountId?: string) => invokeHost<T>('channels', 'deleteConfig', { channelType, accountId }),
  saveBinding: <T = unknown>(input: unknown) => invokeHost<T>('channels', 'bindingSave', input),
  deleteBinding: <T = unknown>(input: unknown) => invokeHost<T>('channels', 'bindingDelete', input),
  startLogin: <T = unknown>(channelType: string, input?: unknown) => invokeHost<T>('channels', 'startLogin', { channelType, input }),
  cancelLogin: <T = unknown>(channelType: string) => invokeHost<T>('channels', 'cancelLogin', { channelType }),
},
agents: {
  list: <T = unknown>() => invokeHost<T>('agents', 'list'),
  save: <T = unknown>(input: unknown) => invokeHost<T>('agents', 'save', input),
  delete: <T = unknown>(id: string) => invokeHost<T>('agents', 'delete', { id }),
},
diagnostics: {
  gatewaySnapshot: <T = unknown>() => invokeHost<T>('diagnostics', 'gatewaySnapshot'),
},
```

- [ ] **Step 5: Migrate renderer call sites**

Replace path calls in:

- `src/pages/Channels/index.tsx`
- `src/pages/Agents/index.tsx`
- `src/components/channels/ChannelConfigModal.tsx`
- `src/stores/channels.ts`

Examples:

```ts
const channelsRes = await hostApi.channels.accounts<ChannelAccountsResponse>();
const agentsRes = await hostApi.agents.list<AgentsResponse>();
await hostApi.channels.deleteConfig(deleteTarget.channelType, deleteTarget.accountId);
await hostApi.channels.startLogin(selectedType, payload);
const snapshot = await hostApi.diagnostics.gatewaySnapshot<GatewayDiagnosticSnapshot>();
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/channels-page.test.tsx tests/unit/agents-page.test.tsx
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/channels-api.ts electron/services/agents-api.ts electron/services/diagnostics-api.ts electron/main/ipc-handlers.ts src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts src/pages/Channels/index.tsx src/pages/Agents/index.tsx src/components/channels/ChannelConfigModal.tsx src/stores/channels.ts tests/unit/host-api-facade.test.ts tests/unit/channels-page.test.tsx tests/unit/agents-page.test.tsx
git commit -m "refactor(host-api): migrate channels and agents to typed ipc"
```

## Task 5: Migrate Providers And OAuth APIs

**Files:**
- Create: `electron/services/providers-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/stores/providers.ts`
- Modify: `src/lib/provider-accounts.ts`
- Modify: `src/components/settings/ProvidersSettings.tsx`
- Test: `tests/unit/provider-store-init.test.ts`
- Test: `tests/unit/provider-store-validation.test.ts`
- Test: `tests/e2e/provider-lifecycle.spec.ts`

- [ ] **Step 1: Write provider facade test cases**

Add to `tests/unit/host-api-facade.test.ts`:

```ts
it('calls providers.list through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.providers.list();
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'providers',
    action: 'list',
  }));
});
```

- [ ] **Step 2: Extract providers service**

Create `electron/services/providers-api.ts` by moving behavior from:

- `electron/api/routes/providers.ts`
- provider branch of `registerUnifiedRequestHandlers()` in `electron/main/ipc-handlers.ts`

Expose actions:

```ts
export function createProvidersApi(deps: { gatewayManager: GatewayManager; mainWindow: BrowserWindow }) {
  return {
    list: async () => await providerService.listLegacyProvidersWithKeyInfo(),
    get: async (payload?: unknown) => await getProviderFromPayload(payload),
    getDefault: async () => await providerService.getDefaultLegacyProvider(),
    hasApiKey: async (payload?: unknown) => await hasApiKeyFromPayload(payload),
    getApiKey: async (payload?: unknown) => await getApiKeyFromPayload(payload),
    validateKey: async (payload?: unknown) => await validateKeyFromPayload(payload),
    save: async (payload?: unknown) => await saveProviderFromPayload(payload, deps.gatewayManager),
    delete: async (payload?: unknown) => await deleteProviderFromPayload(payload, deps.gatewayManager),
    setApiKey: async (payload?: unknown) => await setProviderApiKeyFromPayload(payload),
    updateWithKey: async (payload?: unknown) => await updateProviderWithKeyFromPayload(payload, deps.gatewayManager),
    deleteApiKey: async (payload?: unknown) => await deleteProviderApiKeyFromPayload(payload),
    setDefault: async (payload?: unknown) => await setDefaultProviderFromPayload(payload, deps.gatewayManager),
    accounts: async () => await listProviderAccounts(),
    vendors: async () => await listProviderVendors(),
    requestOAuth: async (payload?: unknown) => await requestOAuthFromPayload(payload, deps.mainWindow),
    cancelOAuth: async (payload?: unknown) => await cancelOAuthFromPayload(payload),
    submitOAuth: async (payload?: unknown) => await submitOAuthFromPayload(payload),
  };
}
```

Use existing provider service functions and OAuth managers; preserve rollback behavior from the current IPC handlers.

- [ ] **Step 3: Register providers service**

Add:

```ts
providers: createProvidersApi({ gatewayManager, mainWindow }),
```

to the typed service registry.

- [ ] **Step 4: Extend renderer facade**

Add `hostApi.providers` methods:

```ts
providers: {
  list: <T = unknown>() => invokeHost<T>('providers', 'list'),
  get: <T = unknown>(providerId: string) => invokeHost<T>('providers', 'get', { providerId }),
  getDefault: <T = unknown>() => invokeHost<T>('providers', 'getDefault'),
  hasApiKey: <T = unknown>(providerId: string) => invokeHost<T>('providers', 'hasApiKey', { providerId }),
  getApiKey: <T = unknown>(providerId: string) => invokeHost<T>('providers', 'getApiKey', { providerId }),
  validateKey: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'validateKey', input),
  save: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'save', input),
  delete: <T = unknown>(providerId: string) => invokeHost<T>('providers', 'delete', { providerId }),
  updateWithKey: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'updateWithKey', input),
  setDefault: <T = unknown>(providerId: string) => invokeHost<T>('providers', 'setDefault', { providerId }),
  accounts: <T = unknown>() => invokeHost<T>('providers', 'accounts'),
  vendors: <T = unknown>() => invokeHost<T>('providers', 'vendors'),
  requestOAuth: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'requestOAuth', input),
  cancelOAuth: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'cancelOAuth', input),
  submitOAuth: <T = unknown>(input: unknown) => invokeHost<T>('providers', 'submitOAuth', input),
},
```

- [ ] **Step 5: Migrate renderer provider call sites**

Replace `hostApiFetch` and old `invokeIpc` provider calls in:

- `src/stores/providers.ts`
- `src/lib/provider-accounts.ts`
- `src/components/settings/ProvidersSettings.tsx`

Example replacements:

```ts
const providers = await hostApi.providers.list<ProviderConfig[]>();
const valid = await hostApi.providers.validateKey<ValidationResult>({ providerId, apiKey, options });
await hostApi.providers.updateWithKey({ providerId, updates, apiKey });
const accounts = await hostApi.providers.accounts<ProviderAccount[]>();
await hostApi.providers.requestOAuth({ providerId, providerType });
```

- [ ] **Step 6: Verify provider tests**

Run:

```bash
pnpm exec vitest run tests/unit/provider-store-init.test.ts tests/unit/provider-store-validation.test.ts tests/unit/host-api-facade.test.ts
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/providers-api.ts electron/main/ipc-handlers.ts src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts src/stores/providers.ts src/lib/provider-accounts.ts src/components/settings/ProvidersSettings.tsx tests/unit/provider-store-init.test.ts tests/unit/provider-store-validation.test.ts tests/unit/host-api-facade.test.ts
git commit -m "refactor(providers): migrate provider flows to typed host api"
```

## Task 6: Migrate Chat, Sessions, Files, And Media

**Files:**
- Create: `electron/services/files-api.ts`
- Create: `electron/services/media-api.ts`
- Create: `electron/services/sessions-api.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/stores/chat/history-actions.ts`
- Modify: `src/stores/chat/runtime-send-actions.ts`
- Modify: `src/stores/chat/session-actions.ts`
- Modify: `src/stores/chat/history-transcript-fallback.ts`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/lib/image-generation.ts`
- Test: chat-related unit tests under `tests/unit/chat-*.test.ts*`

- [ ] **Step 1: Add facade tests for chat media and sessions**

Extend `tests/unit/host-api-facade.test.ts`:

```ts
it('calls chat.sendWithMedia through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true } });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.chat.sendWithMedia({ sessionKey: 'main', message: 'hello', idempotencyKey: 'k' });
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'chat',
    action: 'sendWithMedia',
  }));
});

it('calls sessions.summaries through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, summaries: [] } });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.sessions.summaries({ limit: 20 });
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'sessions',
    action: 'summaries',
  }));
});
```

- [ ] **Step 2: Extract file, media, and session services**

Move logic from:

- `electron/api/routes/files.ts` -> `electron/services/files-api.ts`
- `electron/api/routes/media.ts` -> `electron/services/media-api.ts`
- `electron/api/routes/sessions.ts` -> `electron/services/sessions-api.ts`
- `chat:sendWithMedia` handler in `electron/main/ipc-handlers.ts` -> a `chat.sendWithMedia` service action

Expose actions:

```ts
files: {
  stagePaths,
  stageBuffer,
  readText,
  readBinary,
  writeText,
  stat,
  listDir,
  listTree,
}
media: {
  thumbnails,
  saveImage,
  imageGenerationSettings,
  saveImageGenerationSettings,
  imageGenerationProviders,
  testImageGeneration,
}
sessions: {
  delete,
  rename,
  summaries,
  history,
}
chat: {
  sendWithMedia,
}
```

Preserve hard-delete behavior for sessions and the current image attachment behavior in `chat:sendWithMedia`.

- [ ] **Step 3: Register services**

Add to typed registry:

```ts
files: createFilesApi(),
media: createMediaApi(),
sessions: createSessionsApi(),
chat: createChatApi({ gatewayManager }),
```

- [ ] **Step 4: Extend renderer facade**

Add methods:

```ts
files: {
  stagePaths: <T = unknown>(input: unknown) => invokeHost<T>('files', 'stagePaths', input),
  stageBuffer: <T = unknown>(input: unknown) => invokeHost<T>('files', 'stageBuffer', input),
  readText: <T = unknown>(path: string) => invokeHost<T>('files', 'readText', { path }),
  readBinary: <T = unknown>(path: string, opts?: unknown) => invokeHost<T>('files', 'readBinary', { path, opts }),
  writeText: <T = unknown>(path: string, content: string) => invokeHost<T>('files', 'writeText', { path, content }),
  stat: <T = unknown>(path: string) => invokeHost<T>('files', 'stat', { path }),
  listDir: <T = unknown>(path: string) => invokeHost<T>('files', 'listDir', { path }),
  listTree: <T = unknown>(path: string, opts?: unknown) => invokeHost<T>('files', 'listTree', { path, opts }),
},
media: {
  thumbnails: <T = unknown>(input: unknown) => invokeHost<T>('media', 'thumbnails', input),
  saveImage: <T = unknown>(input: unknown) => invokeHost<T>('media', 'saveImage', input),
},
sessions: {
  delete: <T = unknown>(id: string) => invokeHost<T>('sessions', 'delete', { id }),
  rename: <T = unknown>(id: string, title: string) => invokeHost<T>('sessions', 'rename', { id, title }),
  summaries: <T = unknown>(input?: unknown) => invokeHost<T>('sessions', 'summaries', input),
  history: <T = unknown>(input: unknown) => invokeHost<T>('sessions', 'history', input),
},
chat: {
  sendWithMedia: <T = unknown>(input: unknown) => invokeHost<T>('chat', 'sendWithMedia', input),
},
```

- [ ] **Step 5: Migrate chat call sites**

Replace:

```ts
invokeIpc('gateway:rpc', method, params, timeoutMs)
```

with:

```ts
hostApi.gateway.rpc(method, params, timeoutMs)
```

in:

- `src/stores/chat/history-actions.ts`
- `src/stores/chat/runtime-send-actions.ts`
- `src/stores/chat/session-actions.ts`

Replace session/history/file/media `hostApiFetch` calls with typed methods in:

- `src/stores/chat.ts`
- `src/stores/chat/history-transcript-fallback.ts`
- `src/pages/Chat/ChatInput.tsx`
- `src/pages/Chat/index.tsx`
- `src/lib/image-generation.ts`

- [ ] **Step 6: Verify chat and media tests**

Run:

```bash
pnpm exec vitest run tests/unit/chat-history-actions.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/chat-input.test.tsx tests/unit/chat-target-routing.test.ts tests/unit/host-api-facade.test.ts
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/files-api.ts electron/services/media-api.ts electron/services/sessions-api.ts electron/main/ipc-handlers.ts src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts src/stores/chat.ts src/stores/chat/history-actions.ts src/stores/chat/runtime-send-actions.ts src/stores/chat/session-actions.ts src/stores/chat/history-transcript-fallback.ts src/pages/Chat/ChatInput.tsx src/pages/Chat/index.tsx src/lib/image-generation.ts tests/unit/host-api-facade.test.ts tests/unit/chat-history-actions.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/chat-input.test.tsx tests/unit/chat-target-routing.test.ts
git commit -m "refactor(chat): route chat and file APIs through typed host api"
```

## Task 7: Migrate Cron, Skills, Usage, Models, And ClawHub

**Files:**
- Create: `electron/services/cron-api.ts`
- Create: `electron/services/skills-api.ts`
- Create: `electron/services/usage-api.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/stores/cron.ts`
- Modify: `src/pages/Cron/index.tsx`
- Modify: `src/stores/skills.ts`
- Modify: `src/pages/Skills/index.tsx`
- Modify: `src/pages/Models/index.tsx`
- Modify: `src/pages/Models/usage-history.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `tests/unit/cron-store-fetch-dedupe.test.ts`
- Test: `tests/unit/skills-store-fetch-parallel.test.ts`
- Test: `tests/unit/models-page.test.tsx`

- [ ] **Step 1: Add facade tests**

Add to `tests/unit/host-api-facade.test.ts`:

```ts
it('calls cron.list through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.cron.list();
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'cron',
    action: 'list',
  }));
});

it('calls skills.clawhubList through hostInvoke', async () => {
  hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, results: [] } });
  const { hostApi } = await import('@/lib/host-api');

  await hostApi.skills.clawhubList();
  expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
    module: 'skills',
    action: 'clawhubList',
  }));
});
```

- [ ] **Step 2: Extract cron, skills, usage services**

Move logic from:

- `electron/api/routes/cron.ts` -> `electron/services/cron-api.ts`
- `electron/api/routes/skills.ts` plus ClawHub handlers in `electron/main/ipc-handlers.ts` -> `electron/services/skills-api.ts`
- `electron/api/routes/usage.ts` -> `electron/services/usage-api.ts`

Expose actions:

```ts
cron: {
  list,
  create,
  update,
  delete,
  toggle,
  trigger,
  deliveryTargets,
}
skills: {
  configs,
  updateConfig,
  allConfigs,
  clawhubList,
  clawhubSearch,
  clawhubInstall,
  clawhubUninstall,
  clawhubOpenSkillReadme,
}
usage: {
  recentTokenHistory,
}
```

Preserve current Gateway RPC payload shapes for cron actions.

- [ ] **Step 3: Register services**

Add:

```ts
cron: createCronApi({ gatewayManager }),
skills: createSkillsApi({ clawHubService }),
usage: createUsageApi(),
```

to the typed registry.

- [ ] **Step 4: Extend renderer facade**

Add:

```ts
cron: {
  list: <T = unknown>() => invokeHost<T>('cron', 'list'),
  create: <T = unknown>(input: unknown) => invokeHost<T>('cron', 'create', input),
  update: <T = unknown>(id: string, input: unknown) => invokeHost<T>('cron', 'update', { id, input }),
  delete: <T = unknown>(id: string) => invokeHost<T>('cron', 'delete', { id }),
  toggle: <T = unknown>(id: string, enabled: boolean) => invokeHost<T>('cron', 'toggle', { id, enabled }),
  trigger: <T = unknown>(id: string) => invokeHost<T>('cron', 'trigger', { id }),
  deliveryTargets: <T = unknown>() => invokeHost<T>('cron', 'deliveryTargets'),
},
skills: {
  configs: <T = unknown>() => invokeHost<T>('skills', 'configs'),
  updateConfig: <T = unknown>(input: unknown) => invokeHost<T>('skills', 'updateConfig', input),
  allConfigs: <T = unknown>() => invokeHost<T>('skills', 'allConfigs'),
  clawhubList: <T = unknown>() => invokeHost<T>('skills', 'clawhubList'),
  clawhubSearch: <T = unknown>(input: unknown) => invokeHost<T>('skills', 'clawhubSearch', input),
  clawhubInstall: <T = unknown>(input: unknown) => invokeHost<T>('skills', 'clawhubInstall', input),
  clawhubUninstall: <T = unknown>(input: unknown) => invokeHost<T>('skills', 'clawhubUninstall', input),
  clawhubOpenSkillReadme: <T = unknown>(input: unknown) => invokeHost<T>('skills', 'clawhubOpenSkillReadme', input),
},
usage: {
  recentTokenHistory: <T = unknown>(limit?: number) => invokeHost<T>('usage', 'recentTokenHistory', { limit }),
},
```

- [ ] **Step 5: Migrate renderer call sites**

Replace `hostApiFetch` calls in:

- `src/stores/cron.ts`
- `src/pages/Cron/index.tsx`
- `src/stores/skills.ts`
- `src/pages/Skills/index.tsx`
- `src/pages/Models/index.tsx`
- `src/pages/Models/usage-history.ts`
- `src/components/layout/Sidebar.tsx`

Example replacements:

```ts
const jobs = await hostApi.cron.list<CronJob[]>();
await hostApi.cron.toggle(id, enabled);
const configs = await hostApi.skills.configs<SkillConfigMap>();
const entries = await hostApi.usage.recentTokenHistory<UsageHistoryEntry[]>();
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm exec vitest run tests/unit/cron-store-fetch-dedupe.test.ts tests/unit/skills-store-fetch-parallel.test.ts tests/unit/models-page.test.tsx tests/unit/host-api-facade.test.ts
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add electron/services/cron-api.ts electron/services/skills-api.ts electron/services/usage-api.ts electron/main/ipc-handlers.ts src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts src/stores/cron.ts src/pages/Cron/index.tsx src/stores/skills.ts src/pages/Skills/index.tsx src/pages/Models/index.tsx src/pages/Models/usage-history.ts src/components/layout/Sidebar.tsx tests/unit/cron-store-fetch-dedupe.test.ts tests/unit/skills-store-fetch-parallel.test.ts tests/unit/models-page.test.tsx tests/unit/host-api-facade.test.ts
git commit -m "refactor(host-api): migrate cron skills and usage APIs"
```

## Task 8: Add Typed Event Facade And Remove SSE Fallback

**Files:**
- Modify: `src/lib/host-events.ts`
- Modify: `src/stores/gateway.ts`
- Modify: `src/pages/Channels/index.tsx`
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/components/channels/ChannelConfigModal.tsx`
- Modify: `src/components/settings/ProvidersSettings.tsx`
- Test: `tests/unit/host-events.test.ts`

- [ ] **Step 1: Rewrite host event tests for typed methods**

Modify `tests/unit/host-events.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const on = vi.fn();
const off = vi.fn();

beforeEach(() => {
  on.mockReset();
  off.mockReset();
  vi.stubGlobal('window', {
    electron: { ipcRenderer: { on, off } },
  });
});

describe('hostEvents', () => {
  it('subscribes to gateway status over IPC', async () => {
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onGatewayStatus(handler);

    expect(on).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));
  });

  it('does not create EventSource fallback', async () => {
    const eventSource = vi.fn();
    vi.stubGlobal('EventSource', eventSource);
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');

    hostEvents.onGatewayNotification(vi.fn());

    expect(eventSource).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement typed event facade**

Modify `src/lib/host-events.ts`:

```ts
type Handler<T> = (payload: T) => void;

function onIpc<T>(channel: string, handler: Handler<T>): () => void {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc?.on) {
    console.warn(`[host-events] IPC unavailable for ${channel}`);
    return () => {};
  }
  const unsubscribe = ipc.on(channel, (payload: unknown) => handler(payload as T));
  return typeof unsubscribe === 'function'
    ? unsubscribe
    : () => ipc.off?.(channel);
}

export const hostEvents = {
  onGatewayStatus: <T>(handler: Handler<T>) => onIpc('gateway:status-changed', handler),
  onGatewayError: <T>(handler: Handler<T>) => onIpc('gateway:error', handler),
  onGatewayNotification: <T>(handler: Handler<T>) => onIpc('gateway:notification', handler),
  onGatewayHealth: <T>(handler: Handler<T>) => onIpc('gateway:health-changed', handler),
  onGatewayPresence: <T>(handler: Handler<T>) => onIpc('gateway:presence-changed', handler),
  onGatewayChatMessage: <T>(handler: Handler<T>) => onIpc('gateway:chat-message', handler),
  onGatewayChannelStatus: <T>(handler: Handler<T>) => onIpc('gateway:channel-status', handler),
  onGatewayExit: <T>(handler: Handler<T>) => onIpc('gateway:exit', handler),
  onOAuthCode: <T>(handler: Handler<T>) => onIpc('oauth:code', handler),
  onOAuthSuccess: <T>(handler: Handler<T>) => onIpc('oauth:success', handler),
  onOAuthError: <T>(handler: Handler<T>) => onIpc('oauth:error', handler),
  onChannelQr: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-qr`, handler),
  onChannelSuccess: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-success`, handler),
  onChannelError: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-error`, handler),
};
```

Do not export `subscribeHostEvent()` in the final version.

- [ ] **Step 3: Migrate event call sites**

Replace generic subscriptions:

```ts
hostEvents.onGatewayChannelStatus(handler);
hostEvents.onGatewayNotification(handler);
hostEvents.onGatewayHealth(handler);
hostEvents.onGatewayPresence(handler);
hostEvents.onGatewayChatMessage(handler);
hostEvents.onOAuthCode(handler);
hostEvents.onOAuthSuccess(handler);
hostEvents.onOAuthError(handler);
hostEvents.onChannelQr(channelType, handler);
hostEvents.onChannelSuccess(channelType, handler);
hostEvents.onChannelError(channelType, handler);
```

in:

- `src/stores/gateway.ts`
- `src/pages/Channels/index.tsx`
- `src/pages/Agents/index.tsx`
- `src/components/channels/ChannelConfigModal.tsx`
- `src/components/settings/ProvidersSettings.tsx`

- [ ] **Step 4: Verify no SSE fallback remains**

Run:

```bash
rg "allow-sse-fallback|EventSource|createHostEventSource|subscribeHostEvent" src tests/unit/host-events.test.ts
```

Expected: no production matches; `tests/unit/host-events.test.ts` may mention `EventSource` only to assert it is unused.

- [ ] **Step 5: Run event tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-events.test.ts tests/unit/gateway-events.test.ts tests/unit/channels-page.test.tsx tests/unit/agents-page.test.tsx
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/host-events.ts src/stores/gateway.ts src/pages/Channels/index.tsx src/pages/Agents/index.tsx src/components/channels/ChannelConfigModal.tsx src/components/settings/ProvidersSettings.tsx tests/unit/host-events.test.ts
git commit -m "refactor(events): replace host event fallback with typed ipc events"
```

## Task 9: Remove Host API HTTP Server And Route Layer

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/extensions/types.ts`
- Modify: `electron/extensions/registry.ts`
- Delete: `electron/api/server.ts`
- Delete: `electron/api/context.ts`
- Delete: `electron/api/event-bus.ts`
- Delete: `electron/api/route-utils.ts`
- Delete: `electron/api/routes/*.ts`
- Delete: `electron/main/ipc/host-api-proxy.ts`
- Modify: `src/lib/host-api.ts`
- Test: `tests/unit/host-api.test.ts`

- [ ] **Step 1: Remove old Host API tests**

Delete `tests/unit/host-api.test.ts` because `hostApiFetch` and localhost fallback are removed. Replace any remaining coverage with `tests/unit/host-api-facade.test.ts`. Keep `src/lib/host-api.ts` as the public typed facade entrypoint.

- [ ] **Step 2: Remove Host API server startup**

Modify `electron/main/index.ts`:

- Remove imports for `Server`, `startHostApiServer`, and `HostEventBus`.
- Remove `hostApiServer` and `hostEventBus` globals.
- Remove `hostApiServer = startHostApiServer(...)`.
- Replace each removed `hostEventBus.emit(...)` call with the existing IPC channel that Renderer typed events subscribe to:
  - `gateway:status` -> `mainWindow?.webContents.send('gateway:status-changed', status)`
  - `gateway:error` -> `mainWindow?.webContents.send('gateway:error', { message: error.message })`
  - `gateway:notification` -> `mainWindow?.webContents.send('gateway:notification', notification)`
  - `gateway:health` -> `mainWindow?.webContents.send('gateway:health-changed', data)`
  - `gateway:presence` -> `mainWindow?.webContents.send('gateway:presence-changed', data)`
  - `gateway:chat-message` -> `mainWindow?.webContents.send('gateway:chat-message', data)`
  - `gateway:channel-status` -> `mainWindow?.webContents.send('gateway:channel-status', data)`
  - `gateway:exit` -> `mainWindow?.webContents.send('gateway:exit', { code })`
  - `oauth:code` -> `mainWindow?.webContents.send('oauth:code', payload)`
  - `oauth:success` -> `mainWindow?.webContents.send('oauth:success', { ...payload, success: true })`
  - `oauth:error` -> `mainWindow?.webContents.send('oauth:error', error)`
  - `channel:whatsapp-qr` -> `mainWindow?.webContents.send('channel:whatsapp-qr', data)`
  - `channel:whatsapp-success` -> `mainWindow?.webContents.send('channel:whatsapp-success', data)`
  - `channel:whatsapp-error` -> `mainWindow?.webContents.send('channel:whatsapp-error', error)`

- [ ] **Step 3: Remove proxy handlers**

Modify `electron/main/ipc-handlers.ts`:

- Remove `registerHostApiProxyHandlers()` import and call.
- Remove `gateway:httpProxy` handler.
- Keep `gateway:rpc` only until all direct legacy tests are migrated; production renderer code must use `hostApi.gateway.rpc()`.

Delete `electron/main/ipc/host-api-proxy.ts`.

- [ ] **Step 4: Remove preload allowlist entries**

Modify `electron/preload/index.ts`:

- Remove `hostapi:fetch`.
- Remove `hostapi:token`.
- Remove `gateway:httpProxy`.
- Keep `gateway:rpc` temporarily only if tests or non-migrated internal helpers still require it; remove it in Task 10 after all production references are gone.

- [ ] **Step 5: Remove HTTP route extension point**

Modify `electron/extensions/types.ts` and `electron/extensions/registry.ts`:

```ts
// Remove route handler types and getRouteHandlers().
// Extension context keeps gatewayManager and getMainWindow.
```

Run `rg "registerRouteHandler|getRouteHandlers|RouteHandler" electron/extensions` after editing. Expected: no matches.

- [ ] **Step 6: Delete route layer files**

Delete:

```bash
rm electron/api/server.ts electron/api/context.ts electron/api/event-bus.ts electron/api/route-utils.ts
rm electron/api/routes/*.ts
# Do not delete src/lib/host-api.ts; remove only its legacy hostApiFetch/localhost fallback exports.
```

Use `git rm` for tracked files during implementation:

```bash
git rm electron/api/server.ts electron/api/context.ts electron/api/event-bus.ts electron/api/route-utils.ts electron/api/routes/*.ts electron/main/ipc/host-api-proxy.ts tests/unit/host-api.test.ts
```

- [ ] **Step 7: Verify no Host API fallback remains**

Run:

```bash
rg "hostApiFetch|hostapi:fetch|hostapi:token|startHostApiServer|HostEventBus|allow-localhost-fallback|allow-sse-fallback|/api/events|createHostEventSource" src electron tests
```

Expected: no production matches. Test matches must be removed or renamed to typed host API tests.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts tests/unit/host-events.test.ts
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add electron/main/index.ts electron/main/ipc-handlers.ts electron/preload/index.ts electron/extensions/types.ts electron/extensions/registry.ts src/lib/host-api.ts src/lib/host-api-client.ts src/lib/host-api-types.ts tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts tests/unit/host-events.test.ts
git add -u electron/api electron/main/ipc src/lib tests/unit
git commit -m "refactor(main): remove local host api server"
```

## Task 10: Remove Renderer Gateway Transports And Add Main WS Trace

**Files:**
- Create: `electron/gateway/ws-trace.ts`
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/gateway/ws-client.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh/settings.json`
- Modify: `src/i18n/locales/ja/settings.json`
- Modify: `src/i18n/locales/ru/settings.json`
- Delete: `src/lib/gateway-client.ts` if it is still present. It was already removed in earlier cleanup on some branches; do not recreate it.
- Test: `tests/unit/api-client.test.ts`
- Test: `tests/unit/gateway-ws-trace.test.ts`

- [ ] **Step 1: Add trace redaction tests**

Create `tests/unit/gateway-ws-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { redactGatewayFrameForTrace, summarizeGatewayFrameForTrace } from '../../electron/gateway/ws-trace';

describe('gateway ws trace', () => {
  it('redacts auth and device secrets', () => {
    const redacted = redactGatewayFrameForTrace({
      type: 'req',
      method: 'connect',
      params: {
        auth: { token: 'secret-token' },
        device: { signature: 'device-signature' },
        headers: { Authorization: 'Bearer abc' },
      },
    });

    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('device-signature');
    expect(JSON.stringify(redacted)).not.toContain('Bearer abc');
    expect(JSON.stringify(redacted)).toContain('[redacted]');
  });

  it('summarizes request and event frames', () => {
    expect(summarizeGatewayFrameForTrace({ type: 'req', id: '1', method: 'chat.history' }))
      .toEqual('req id=1 method=chat.history');
    expect(summarizeGatewayFrameForTrace({ type: 'event', event: 'chat' }))
      .toEqual('event chat');
  });
});
```

- [ ] **Step 2: Implement trace helpers**

Create `electron/gateway/ws-trace.ts`:

```ts
const SECRET_KEYS = new Set([
  'token',
  'authorization',
  'apiKey',
  'api_key',
  'signature',
  'cookie',
  'set-cookie',
  'accessToken',
  'refreshToken',
]);

export function isGatewayWsTraceEnabled(): boolean {
  return process.env.CLAWX_GATEWAY_WS_TRACE === '1';
}

export function redactGatewayFrameForTrace(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactGatewayFrameForTrace(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key) || SECRET_KEYS.has(key.toLowerCase())) {
      result[key] = '[redacted]';
    } else {
      result[key] = redactGatewayFrameForTrace(item);
    }
  }
  return result;
}

export function summarizeGatewayFrameForTrace(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;
  const frame = value as Record<string, unknown>;
  if (frame.type === 'req') return `req id=${String(frame.id ?? '-')} method=${String(frame.method ?? '-')}`;
  if (frame.type === 'res') return `res id=${String(frame.id ?? '-')} ok=${String(frame.ok ?? !frame.error)}`;
  if (frame.type === 'event') return `event ${String(frame.event ?? '-')}`;
  if (typeof frame.method === 'string') return `jsonrpc method=${frame.method}`;
  return 'unknown gateway frame';
}
```

- [ ] **Step 3: Wire trace into Main WS send/receive**

Modify `electron/gateway/manager.ts` in `rpc()` before `this.ws.send(...)`:

```ts
if (isGatewayWsTraceEnabled()) {
  logger.debug('[gateway-ws-trace] send', {
    summary: summarizeGatewayFrameForTrace(request),
    frame: redactGatewayFrameForTrace(request),
  });
}
```

Modify `handleMessage()` at entry:

```ts
if (isGatewayWsTraceEnabled()) {
  logger.debug('[gateway-ws-trace] recv', {
    summary: summarizeGatewayFrameForTrace(message),
    frame: redactGatewayFrameForTrace(message),
  });
}
```

Import helpers from `./ws-trace`.

- [ ] **Step 4: Remove Renderer transport code**

Modify `src/lib/api-client.ts`:

- Remove `TransportKind` variants `ws` and `http`.
- Remove custom invoker registry.
- Remove `createHttpTransportInvoker()`.
- Remove `createWsTransportInvoker()`.
- Remove `createGatewayHttpTransportInvoker()`.
- Remove `createGatewayWsTransportInvoker()`.
- Remove `applyGatewayTransportPreference()`.
- Remove `getGatewayWsDiagnosticEnabled()`.
- Remove `setGatewayWsDiagnosticEnabled()`.
- Make `invokeApi()` call `invokeViaIpc()` directly for remaining legacy IPC helpers.

Keep exported `invokeIpc()` and `invokeIpcWithRetry()` if non-business UI code still uses them for window/update/file-preview operations.

- [ ] **Step 5: Remove transport initialization**

Modify `src/main.tsx`:

```ts
// Remove initializeDefaultTransports import and call.
```

Modify `src/App.tsx`:

```ts
// Remove applyGatewayTransportPreference import and useEffect.
```

- [ ] **Step 6: Remove WS Diagnostic UI and locale keys**

Modify `src/pages/Settings/index.tsx`:

- Remove imports for `getGatewayWsDiagnosticEnabled` and `setGatewayWsDiagnosticEnabled`.
- Remove `wsDiagnosticEnabled` state.
- Remove `handleWsDiagnosticToggle`.
- Remove the Settings UI block whose label uses `developer.wsDiagnostic`.

Remove these keys from all four settings locale files:

```json
"wsDiagnostic"
"wsDiagnosticDesc"
"wsDiagnosticEnabled"
"wsDiagnosticDisabled"
```

- [ ] **Step 7: Delete legacy browser Gateway client**

Run only if the file exists:

```bash
git rm src/lib/gateway-client.ts
```

- [ ] **Step 8: Rewrite api-client tests**

Modify `tests/unit/api-client.test.ts` so it covers IPC-only behavior:

```ts
it('uses ipc for gateway rpc by default', async () => {
  const { invokeIpc } = await import('@/lib/api-client');
  invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

  await expect(invokeIpc('gateway:rpc', 'chat.history', {})).resolves.toEqual({ success: true, result: { ok: true } });
  expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', {});
});
```

Remove tests for WS/HTTP fallback, transport backoff, and `gateway:httpProxy`.

- [ ] **Step 9: Verify transport deletion**

Run:

```bash
rg "createGatewayWsTransportInvoker|createGatewayHttpTransportInvoker|gateway:httpProxy|clawx:gateway-ws-diagnostic|getGatewayWsDiagnosticEnabled|setGatewayWsDiagnosticEnabled|initializeDefaultTransports|new WebSocket\\(" src electron tests
```

Expected: only Main Gateway WebSocket code and Gateway WS unit tests match `new WebSocket`; no Renderer transport or diagnostic matches remain.

- [ ] **Step 10: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/api-client.test.ts tests/unit/gateway-ws-trace.test.ts tests/unit/gateway-ws-client.test.ts
pnpm run typecheck
```

Expected: pass.

- [ ] **Step 11: Commit**

```bash
git add electron/gateway/ws-trace.ts electron/gateway/manager.ts electron/gateway/ws-client.ts src/lib/api-client.ts src/main.tsx src/App.tsx src/pages/Settings/index.tsx src/i18n/locales/en/settings.json src/i18n/locales/zh/settings.json src/i18n/locales/ja/settings.json src/i18n/locales/ru/settings.json tests/unit/api-client.test.ts tests/unit/gateway-ws-trace.test.ts
git add -u src/lib/gateway-client.ts
git commit -m "refactor(gateway): remove renderer gateway transports"
```

## Task 11: Update E2E Fixtures, Harness Rules, And Documentation

**Files:**
- Modify: `tests/e2e/fixtures/electron.ts`
- Modify: `tests/e2e/*.spec.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify/Delete: `harness/specs/rules/host-api-fallback-policy.md`
- Modify/Delete: `harness/specs/rules/api-client-transport-policy.md`
- Modify/Delete: `harness/specs/rules/host-events-fallback-policy.md`

- [ ] **Step 1: Update E2E fixtures from `hostapi:fetch` to `host:invoke`**

In `tests/e2e/fixtures/electron.ts`, replace handlers like:

```ts
ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
  return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${request.method ?? 'GET'} ${request.path ?? ''}` } };
});
```

with:

```ts
ipcMain.handle('host:invoke', async (_event, request: { id: string; module: string; action: string; payload?: unknown }) => {
  if (request.module === 'gateway' && request.action === 'status') {
    return { id: request.id, ok: true, data: { state: 'running', port: 18789, gatewayReady: true } };
  }
  return {
    id: request.id,
    ok: false,
    error: { code: 'UNSUPPORTED', message: `Unexpected host request: ${request.module}.${request.action}` },
  };
});
```

Update each spec-specific mock to assert `module` and `action` instead of `method` and `path`.

- [ ] **Step 2: Update README architecture sections**

In `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`:

- Remove references to `hostapi:fetch`.
- Remove references to `gateway:httpProxy`.
- Remove references to Renderer WS diagnostic mode.
- Add the new architecture statement:

```text
Renderer backend calls use the typed hostApi facade over Electron IPC. OpenClaw
Gateway RPC is owned by Main through GatewayManager.rpc() and the Main-owned
Gateway WebSocket; Renderer code does not direct-connect to Gateway.
```

Translate the statement for Chinese and Japanese README files.

- [ ] **Step 3: Update harness scenario**

Modify `harness/specs/scenarios/gateway-backend-communication.md`:

```md
- Renderer backend calls must go through `src/lib/host-api` typed facade methods.
- Renderer code must not call `hostApiFetch`, `fetch('http://127.0.0.1:13210')`,
  `gateway:httpProxy`, or direct Gateway WebSocket transports.
- Gateway RPC must enter Main through typed host invoke and call
  `GatewayManager.rpc()`.
```

Remove old allowed fallback flag descriptions.

- [ ] **Step 4: Update or remove harness rules**

For `harness/specs/rules/host-api-fallback-policy.md`, replace content with a forbidden rule:

```md
# Host API Fallback Removal Rule

Renderer code must not use `hostApiFetch`, `hostapi:fetch`, `hostapi:token`,
`clawx:allow-localhost-fallback`, or `http://127.0.0.1:13210`.
Use typed `hostApi.<module>.<action>()` methods instead.
```

For `harness/specs/rules/host-events-fallback-policy.md`, replace content with:

```md
# Host Events IPC Rule

Renderer feature code must subscribe through typed `hostEvents` methods.
`clawx:allow-sse-fallback`, `/api/events`, and `EventSource` host event fallback
are not allowed.
```

For `harness/specs/rules/api-client-transport-policy.md`, replace content with:

```md
# Gateway Transport Rule

Renderer code must not create direct WebSocket or HTTP transports to OpenClaw
Gateway. Gateway RPC must use `hostApi.gateway.rpc()`, which dispatches to Main
and then `GatewayManager.rpc()`.
```

- [ ] **Step 5: Run docs and harness checks**

Run:

```bash
pnpm harness validate --spec harness/specs/scenarios/gateway-backend-communication.md
pnpm run harness:ci
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e README.md README.zh-CN.md README.ja-JP.md harness/specs/scenarios/gateway-backend-communication.md harness/specs/rules/host-api-fallback-policy.md harness/specs/rules/host-events-fallback-policy.md harness/specs/rules/api-client-transport-policy.md
git commit -m "docs: update communication architecture for typed ipc"
```

## Task 12: Final Verification And Cleanup

**Files:**
- Review all changed files.
- No new source files expected unless previous tasks uncovered missing test helpers.

- [ ] **Step 1: Run forbidden-pattern scan**

Run:

```bash
rg "hostApiFetch|hostapi:fetch|hostapi:token|gateway:httpProxy|startHostApiServer|HostEventBus|allow-localhost-fallback|allow-sse-fallback|clawx:gateway-ws-diagnostic|createGatewayWsTransportInvoker|createGatewayHttpTransportInvoker" src electron tests harness README.md README.zh-CN.md README.ja-JP.md
```

Expected: no matches.

- [ ] **Step 2: Run Renderer direct Gateway scan**

Run:

```bash
rg "new WebSocket\\(|ws://127\\.0\\.0\\.1|ws://localhost|/api/app/gateway-info" src
```

Expected: no matches in `src`.

- [ ] **Step 3: Run communication regression tests**

Run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected: both commands complete without regressions.

- [ ] **Step 4: Run focused unit tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-invoke.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts tests/unit/api-client.test.ts tests/unit/gateway-ws-client.test.ts tests/unit/gateway-ws-trace.test.ts
```

Expected: pass.

- [ ] **Step 5: Run full validation**

Run:

```bash
pnpm run typecheck
pnpm test
pnpm run test:e2e
pnpm run harness:ci
```

Expected: all pass. If Electron E2E fails due to expected headless dbus warnings only, confirm the Playwright result itself is passing.

- [ ] **Step 6: Final docs scan**

Run:

```bash
rg "hostapi:fetch|gateway:httpProxy|WS Diagnostic|Host API server|13210" README.md README.zh-CN.md README.ja-JP.md docs harness src electron
```

Expected: no stale product architecture claims. Mentions inside this plan or the approved design spec are acceptable.

- [ ] **Step 7: Commit final cleanup**

```bash
git add .
git commit -m "chore: finalize typed ipc migration cleanup"
```

If there are no changes after verification, skip the commit and record the clean status in the final implementation report.
