---
id: gateway-heartbeat-safety
title: Gateway Heartbeat Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
---

WebSocket heartbeat misses are availability and diagnostic evidence, not proof that the local Gateway process is dead.

Reaching the heartbeat miss threshold must update diagnostics and health state, but must not by itself terminate the socket, kill the owned Gateway process, or request `GatewayManager.restart`. Long-running model, tool, compaction, and scheduled work may temporarily block Gateway control-plane responses while remaining valid.

Automatic lifecycle recovery remains owned by authoritative transport and process signals such as child-process exit, WebSocket close, and Gateway restart close code 1012. Explicit user restart remains available.

Do not weaken this rule by only increasing heartbeat intervals or miss thresholds. A timeout change delays false recovery but does not make missing pong frames proof of process death.
