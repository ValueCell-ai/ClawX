---
id: gateway-backend-communication
title: Gateway Backend Communication
type: runtime-bridge
ownedPaths:
  - src/lib/api-client.ts
  - src/lib/host-api.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/stores/chat/session-catalog.ts
  - electron/main/ipc/**
  - electron/services/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-catalog.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/chat-session-management.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/session-label-hydration.test.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - shared/web-browser.ts
  - electron/main/web-browser-policy.ts
  - electron/main/web-browser-session.ts
  - electron/services/web-browser-api.ts
  - tests/unit/web-browser-url.test.ts
  - tests/unit/web-browser-policy.test.ts
  - tests/unit/web-browser-session.test.ts
  - tests/unit/web-browser-api.test.ts
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
      - Web Browser guest, navigation, session, permission, or data policy changes
requiredRules:
  - openclaw-config-delivery
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - issue-report-export-safety
  - gateway-readiness-policy
  - gateway-heartbeat-safety
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - provider-default-invariant
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - custom-provider-request-timeout
  - sidebar-session-attention-authority
  - web-browser-security-and-lifecycle
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:18789 in src/**
  - fetch("http://127.0.0.1:18789 in src/**
  - fetch('http://localhost:18789 in src/**
  - fetch("http://localhost:18789 in src/**
  - new WebSocket('ws://127.0.0.1:18789 in src/**
  - new WebSocket("ws://127.0.0.1:18789 in src/**
  - new WebSocket('ws://localhost:18789 in src/**
  - new WebSocket("ws://localhost:18789 in src/**
---

Gateway backend communication covers all ClawX paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Coordinator-owned OpenClaw config mutations and their `config.get`/`config.set` transaction contract are documented in `harness/reference/openclaw-config-delivery.md`.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` or `src/lib/api-client.ts` -> Electron Main typed host service or IPC handler -> Main-owned OpenClaw Gateway WebSocket -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Renderer code must not create direct Gateway WebSocket connections. Gateway frame diagnostics must be emitted by Main-process Gateway logging.

Typed generic Gateway RPC requests are validated by `electron/services/gateway-api.ts` and delegated directly to `GatewayManager.rpc`, including an optional positive finite timeout. This path has no Renderer Chat history/send specialization, polling queue, coalescing, or backpressure layer. ACP `session/load`, `session/prompt`, and `session/cancel` own ordinary Chat history and composer behavior independently.

Channel/plugin migration behavior is also part of this scenario when ClawX rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

ClawX's prelaunch config sanitizer also owns desktop tool policy. It must keep `web_search` in both the agent-level and Gateway-level deny lists without replacing existing deny entries or disabling managed browser automation and `web_fetch`. It must also deny the agent-facing `gateway`, `nodes`, `create_goal`, `get_goal`, and `update_goal` tools at both layers while preserving application-owned Gateway RPCs. Messaging, session orchestration, and agent discovery tools remain available unless another explicit policy denies them.

Scheduled-task history is Main-owned backend data. Current OpenClaw versions must be queried through the Gateway `cron.runs` RPC; direct run-log file reads are allowed only as a compatibility fallback for older file-backed runtimes. When a run's bounded summary ends with OpenClaw's truncation ellipsis, Main may recover the complete final assistant reply from the run transcript identified by that `cron.runs` entry, but only when the transcript reply is longer and shares the entire summary prefix. When a cron base session has no ACP replay, Renderer may project that typed host result into a generation-scoped, in-memory historical ACP timeline, but must not replace or duplicate non-empty ACP replay.

The local HTML Preview privileged bridge is also Main-owned: Renderer may load a validated local HTML file or open that current file externally through the typed Host API. The guest is an implementation detail of the existing `preview` tab; there is no `web-browser` artifact tab or general address navigation. The durable guest contract is `harness/reference/web-browser.md`.

Gateway session-catalog subscription, normalization, ordered list/event replay, attention transitions, and reconnect recovery are documented in `harness/reference/sidebar-session-attention.md`. The first prompt sent to a newly created non-default Agent must title its `agent:<id>:main` conversation; synthetic transport display names such as `ACP` must not replace that label, and transcript-summary hydration must restore it after reload. Deleting an Agent is also a session-catalog lifecycle boundary: after Main confirms the destructive config/filesystem operation, Renderer must immediately forget every canonical `agent:<deletedId>:` row, retain an in-memory tombstone that blocks stale list rows and delayed events, and repair selection without waiting for a Gateway restart. An authoritative Agent snapshot containing the same ID clears the tombstone to support recreation, but an Agent-list request that predates a confirmed mutation must not publish or reconcile afterward. An already-absent session index or entry is an idempotent conversation-delete success, while malformed indexes and unsafe transcript paths remain failures. Electron test-process isolation and global-resource scheduling are documented in `harness/reference/e2e-parallelism.md`.

ClawX-owned `models.providers.custom-*` entries receive a missing-only 45-second provider request timeout in both global and per-Agent runtime configuration. Explicit timeout values remain user-owned, and non-custom providers are not changed. This bounds silent OpenAI-compatible provider attempts before the independent Gateway liveness deadline without weakening Gateway recovery.

Gateway WebSocket heartbeat misses are diagnostic availability signals only and must never directly interrupt the socket or process. A pong, any incoming Gateway frame, or a successful Gateway RPC is trusted liveness evidence and resets the 180 seconds silence deadline. After one uninterrupted deadline, Main runs exactly one 5000ms `system-presence` verification. A successful probe records liveness and cancels recovery. A failed probe may request guarded restart only for a ClawX-owned process; for an externally managed Gateway, Main may reconnect its own transport and expose unavailable diagnostics but never stop, shut down, or restart the Gateway automatically. This path does not track chat, tool, cron, or other workloads. Process exit, ordinary socket close, code 1012, and explicit user restart retain their separate lifecycle behavior.
