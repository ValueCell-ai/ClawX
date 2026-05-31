---
id: host-api-fallback-policy
title: Host API Typed IPC Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-invoke.test.ts
---

Renderer Host API requests must use the typed `hostApi.<module>.<action>()` facade and `host:invoke` bridge.

The local Host API HTTP server and browser fallback to `http://127.0.0.1:13210` are removed and must not be reintroduced.

Pages and components must not call `window.electron.ipcRenderer.invoke(...)` directly for backend data; expose typed host-api/api-client methods instead.
