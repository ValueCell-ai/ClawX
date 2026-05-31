---
id: api-client-transport-policy
title: API Client Transport Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/api-client.test.ts
---

Gateway RPC transport is IPC-only. Renderer code must not enable WebSocket or HTTP transports to OpenClaw Gateway.

The renderer must call Main through typed host-api or legacy IPC wrappers only; Main owns the Gateway WebSocket.

Gateway frame diagnostics belong in Main-process logging, not renderer direct Gateway connections.
