# Remove Host API Server and Renderer Gateway Transports Design

## Summary

ClawX should remove its local Host API HTTP server and the renderer-side direct
Gateway WebSocket/HTTP diagnostic transports. The application will use a single
Electron IPC boundary between Renderer and Main, exposed to Renderer code through
a typed `hostApi` facade. OpenClaw Gateway control remains Main-owned: Main starts
the Gateway process, owns the only production Gateway WebSocket, and performs all
Gateway RPC calls through `GatewayManager.rpc()`.

## Goals

- Remove the local ClawX Host API HTTP server on `127.0.0.1:13210`.
- Replace `hostApiFetch('/api/...')` route calls with a typed Renderer facade such
  as `hostApi.settings.getAll()` and `hostApi.gateway.restart()`.
- Prevent pages, components, and stores from hand-writing IPC channel names.
- Remove Renderer direct Gateway WebSocket and Gateway HTTP fallback transports.
- Keep OpenClaw Gateway access centralized in Main through `GatewayManager`.
- Replace the old Renderer WS diagnostic path with an optional Main-side Gateway
  WebSocket trace log.

## Non-Goals

- Do not change OpenClaw Gateway protocol semantics.
- Do not refactor `GatewayManager` lifecycle logic except where needed for trace
  logging.
- Do not introduce code generation for IPC contracts in this refactor.
- Do not preserve the Host API as an external control API.
- Do not preserve the HTTP route extension point; future extensions should use a
  Main service or IPC extension point.

## Target Architecture

The final runtime path is:

```text
Renderer
  -> typed hostApi facade
  -> preload single invoke bridge
  -> Main typed dispatcher
  -> Main services / GatewayManager / filesystem / stores
  -> OpenClaw Gateway only through Main-owned WebSocket
```

The Renderer API should be semantic and typed:

```ts
await hostApi.settings.getAll();
await hostApi.settings.set('theme', theme);
await hostApi.gateway.start();
await hostApi.gateway.rpc('chat.history', params, 5000);
await hostApi.channels.saveConfig(input);
await hostApi.files.stagePaths(paths);
```

Renderer pages, components, and stores must not call
`window.electron.ipcRenderer.invoke(...)` directly for backend business calls and
must not construct path-based Host API requests.

## Components

### Renderer Facade

Create a typed Renderer facade under `src/lib/host-api/`.

Suggested files:

- `src/lib/host-api/index.ts`
- `src/lib/host-api/types.ts`
- `src/lib/host-api/modules/*.ts` if the facade becomes too large

The facade exposes module objects such as:

- `hostApi.settings`
- `hostApi.gateway`
- `hostApi.providers`
- `hostApi.channels`
- `hostApi.agents`
- `hostApi.cron`
- `hostApi.files`
- `hostApi.media`
- `hostApi.sessions`
- `hostApi.skills`
- `hostApi.logs`
- `hostApi.usage`
- `hostApi.diagnostics`

The old `hostApiFetch(path, init)` API should be removed after migration. A
short-lived internal compatibility helper is acceptable during migration, but the
final state must have no production `hostApiFetch` imports or `/api/...` Host API
paths in Renderer code.

### Preload Bridge

Expose one low-level host invocation method through preload, for example:

```ts
window.clawx.hostInvoke(request)
```

The channel name is private to the facade and preload implementation. Renderer
feature code must use `hostApi.<module>.<action>()` and must not hand-write
`host:invoke` or other IPC channel strings.

The request shape is module/action based:

```ts
{
  id: string;
  module: 'settings',
  action: 'getAll',
  payload?: unknown
}
```

### Main Dispatcher

Add a typed Main dispatcher, for example:

- `electron/main/ipc/host-invoke.ts`
- `electron/main/ipc/host-contract.ts`

The dispatcher validates the request shape, dispatches by `module` and `action`,
and returns a consistent success/error envelope. It must call ordinary service
functions, not HTTP route handlers.

### Main Services

Move business logic currently held in `electron/api/routes/*` into normal Main
service functions. The services should parse typed payloads, not URLs, HTTP
methods, or JSON bodies.

Suggested service modules:

- `electron/services/settings-api.ts`
- `electron/services/gateway-api.ts`
- `electron/services/channels-api.ts`
- `electron/services/providers-api.ts`
- `electron/services/agents-api.ts`
- `electron/services/cron-api.ts`
- `electron/services/files-api.ts`
- `electron/services/media-api.ts`
- `electron/services/sessions-api.ts`
- `electron/services/skills-api.ts`
- `electron/services/logs-api.ts`
- `electron/services/usage-api.ts`
- `electron/services/diagnostics-api.ts`

Existing lower-level utilities and services should be reused where they already
own the real behavior.

### Events

Renderer event subscriptions should remain IPC-based. Replace generic
production `subscribeHostEvent()` call sites with a typed event facade, such as:

```ts
hostEvents.onGatewayStatus(handler);
hostEvents.onGatewayNotification(handler);
hostEvents.onGatewayChatMessage(handler);
```

Delete the SSE fallback and `/api/events`. There should be no
`clawx:allow-sse-fallback` policy after the refactor. The final state may keep a
private helper inside the event facade, but feature code must use typed event
methods instead of event-name strings.

### Gateway RPC

The only production Gateway RPC path should be:

```text
Renderer hostApi.gateway.rpc(...)
  -> preload hostInvoke
  -> Main dispatcher
  -> gatewayManager.rpc(...)
  -> Main-owned WebSocket
  -> OpenClaw Gateway
```

Keep the Main-side Gateway lifecycle and protocol code:

- `connectGatewaySocket()`
- `probeGatewayReady()`
- `waitForGatewayReady()`
- `GatewayManager.rpc()`
- `dispatchProtocolEvent()`

Remove Renderer Gateway transports:

- `createGatewayWsTransportInvoker()`
- `createGatewayHttpTransportInvoker()`
- `registerTransportInvoker('ws' | 'http', ...)`
- `applyGatewayTransportPreference()`
- `setGatewayWsDiagnosticEnabled()` and `getGatewayWsDiagnosticEnabled()`
- `clawx:gateway-ws-diagnostic`
- `gateway:httpProxy`
- Settings UI for WS Diagnostic Mode

### Gateway WebSocket Trace

Add an optional Main-side trace log controlled by:

```text
CLAWX_GATEWAY_WS_TRACE=1
```

The trace should log concise summaries of:

- outgoing RPC method, id, and parameter summary
- incoming frame type, id, event, and error summary
- dispatch result as a semantic event name

The trace must redact secrets, including Gateway token, authorization headers,
provider API keys, OAuth tokens, cookies, and device signatures. It should be a
developer logging aid, not a Renderer UI feature.

## Deletions

Delete or fully retire these concepts:

- `electron/api/server.ts`
- `electron/api/routes/*`
- `electron/api/event-bus.ts`
- `electron/main/ipc/host-api-proxy.ts`
- `hostapi:fetch`
- `hostapi:token`
- local Host API browser fallback
- SSE host event fallback
- Host API extension HTTP route handlers
- `src/lib/gateway-client.ts`
- Renderer Gateway WebSocket transport
- Renderer Gateway HTTP transport
- `gateway:httpProxy`
- WS Diagnostic Mode settings UI and i18n

## Migration Strategy

1. Build the typed host invocation foundation.
   - Add preload `hostInvoke`.
   - Add Main `host:invoke` dispatcher.
   - Add Renderer `hostApi` facade.
   - Implement the first modules for `settings`, `gateway`, and `logs`.

2. Migrate Renderer modules from path-based calls to typed facade calls.
   - Replace `hostApiFetch('/api/...')` call sites by feature area.
   - Move route logic to service functions as each area migrates.
   - Update unit and E2E mocks from path/method assertions to module/action
     assertions.

3. Remove the Host API server.
   - Remove server startup from Main initialization.
   - Remove Host API token and proxy handlers.
   - Remove HTTP route files and route utility code once no longer referenced.
   - Remove localhost fallback and SSE fallback tests/rules.

4. Remove Renderer Gateway transports.
   - Remove WS/HTTP transport invokers and diagnostic preference logic.
   - Remove `gateway:httpProxy` from preload and Main.
   - Remove WS Diagnostic Mode UI, tests, and locale keys.
   - Add Main-side Gateway WebSocket trace logging.

## Testing

Unit tests should cover:

- Renderer `hostApi` facade emits the expected module/action/payload requests.
- Main dispatcher routes requests to the correct service function.
- Main dispatcher returns consistent success/error envelopes.
- Gateway RPC requests call `gatewayManager.rpc()` and never Renderer WS/HTTP.
- Host events use IPC only.
- Gateway WebSocket trace redacts sensitive values.

E2E coverage should include:

- Settings read/write.
- Gateway status/start/restart/health.
- Chat send and history loading.
- Channel configuration and account binding.
- Provider save, validation, default selection, and OAuth flows.
- Cron list/create/update/delete/toggle/trigger.
- File staging and media preview.
- Skills/ClawHub flows that currently use Host API routes.

## Documentation And Harness Updates

Update:

- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`
- `harness/specs/scenarios/gateway-backend-communication.md`
- related harness rules that mention Host API fallback, SSE fallback, or Gateway
  WS diagnostic mode

The new documented rule should be:

- Renderer backend calls use the typed `hostApi` facade.
- Renderer does not direct-connect to OpenClaw Gateway.
- OpenClaw Gateway RPC is Main-owned through `GatewayManager.rpc()`.
- Local Host API HTTP fallback and SSE fallback are forbidden.

## Risks

- The migration touches many Renderer call sites and tests.
- Existing E2E fixtures mock `hostapi:fetch`; those fixtures must move to
  `host:invoke` or facade-level mocks.
- Some route handlers contain non-trivial business behavior; moving them into
  services must preserve behavior and error envelopes.
- Removing HTTP extension route handlers is a breaking change for extensions
  that depend on that extension point.
- Deleting diagnostic Renderer WS means DevTools no longer sees Gateway frames;
  Main-side trace logging must be reliable enough for debugging.

## Success Criteria

- No ClawX Host API server listens on `127.0.0.1:13210`.
- `rg "hostApiFetch" src electron` finds no production usage.
- `rg "hostapi:fetch|hostapi:token|gateway:httpProxy" src electron` finds no
  production usage.
- `rg "clawx:allow-localhost-fallback|clawx:allow-sse-fallback|clawx:gateway-ws-diagnostic" src electron harness README*`
  finds no active policy or production usage.
- Renderer `gateway:rpc` direct calls are replaced by `hostApi.gateway.rpc()`.
- Renderer does not create WebSocket connections to OpenClaw Gateway.
- Renderer feature code subscribes through typed event facade methods rather than
  generic host event names.
- All relevant unit tests, Electron E2E tests, and harness checks pass.
