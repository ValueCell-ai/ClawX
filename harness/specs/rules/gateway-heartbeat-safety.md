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

WebSocket heartbeat misses are availability evidence. A short sequence is not proof that the local Gateway process is dead because long-running model, tool, compaction, and scheduled work may temporarily delay Gateway control-plane responses.

Misses one through three must remain diagnostic-only: they must not terminate the socket, kill the owned Gateway process, or request `GatewayManager.restart`. A pong or any incoming Gateway message resets the sequence.

After four consecutive missed responses, ClawX may treat the Gateway as persistently unresponsive and request the guarded `GatewayManager.restart` path only when auto-recovery is enabled and lifecycle state is still `running`. The heartbeat callback must not directly terminate the socket or process, and it must request recovery at most once per uninterrupted miss sequence.

Authoritative child-process exit, WebSocket close, and Gateway restart close code 1012 signals retain their existing automatic lifecycle paths. Explicit user restart remains available.
