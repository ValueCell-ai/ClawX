---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-ws-client.test.ts
---

Gateway status handling must preserve `gatewayReady` semantics.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Managed cold-start readiness must use a finite deadline. When a ClawX-owned process
remains alive without serving the readiness challenge, Main must reclaim that stale
process before scheduling another startup attempt instead of waiting on the same PID.
