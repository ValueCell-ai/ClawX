---
id: host-events-fallback-policy
title: Host Events Fallback Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/host-events.test.ts
---

Host event subscriptions must use IPC mappings by default.

Unknown host events must not fall back to SSE unless `clawx:allow-sse-fallback` is explicitly enabled inside `src/lib/host-events.ts`.

New user-visible gateway, channel, OAuth, or QR events should be added to the host event IPC mapping instead of relying on EventSource fallback.
