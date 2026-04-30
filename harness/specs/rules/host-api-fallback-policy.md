---
id: host-api-fallback-policy
title: Host API Fallback Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/host-api.test.ts
---

Renderer Host API requests must use `hostapi:fetch` IPC proxy by default.

Browser fallback to `http://127.0.0.1:13210` is allowed only inside `src/lib/host-api.ts`, and only when `clawx:allow-localhost-fallback` is explicitly enabled.

The Host API token must be obtained through `hostapi:token`; pages and components must not construct Host API localhost requests directly.
