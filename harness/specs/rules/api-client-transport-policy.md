---
id: api-client-transport-policy
title: API Client Transport Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/api-client.test.ts
---

Gateway RPC transport is IPC-only by default. Renderer code must not enable WebSocket or HTTP transport unless `src/lib/api-client.ts` explicitly gates it behind `clawx:gateway-ws-diagnostic`.

When diagnostics are enabled, the allowed order is `WS -> HTTP -> IPC`; otherwise the allowed order is `IPC`.

Failed non-IPC transports must use backoff before retry. `gateway:httpProxy` remains a Main-owned proxy path and must not become direct renderer Gateway HTTP access.
