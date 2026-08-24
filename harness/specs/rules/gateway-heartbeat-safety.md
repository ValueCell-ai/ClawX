---
id: gateway-heartbeat-safety
title: Gateway Heartbeat Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
---

WebSocket heartbeat misses are diagnostic availability evidence only. A missed pong must never directly terminate a socket, kill a process, or request `GatewayManager.restart`, regardless of how many pongs are missed.

Trusted liveness evidence is a pong, any incoming Gateway frame, or a successful Gateway RPC. Each signal resets the 180 seconds no-liveness deadline and cancels stale verification work. No chat, tool, cron, or workload tracking changes that deadline. An observed OpenClaw `[compaction-diag] start` may defer only owned-process escalation after a failed verification; it must not postpone the deadline or probe, and the deferral must end on `[compaction-diag] end` or a bounded timeout.

Only after 180 seconds without trusted liveness may Main run one `system-presence` core-RPC verification with a 5000ms timeout for that silence generation. A successful probe records liveness and cancels recovery without reconnecting or restarting.

After a failed deadline probe, automatic recovery may use the guarded `GatewayManager.restart` path only for a ClawX-owned Gateway when auto-recovery and lifecycle state permit it. For an externally managed Gateway, ClawX may reconnect its own transport and report unavailability, but must never automatically call `stop`, `shutdown`, or `restart` on that Gateway.

Authoritative child-process exit, ordinary WebSocket close, Gateway restart close code 1012, and explicit user restart retain their existing separate lifecycle paths.
