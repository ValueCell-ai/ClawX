---
id: add-realtime-talk
title: Add OpenClaw Gateway Relay realtime Talk to ClawX Chat
scenario: gateway-backend-communication
scenarios:
  - realtime-talk
taskType: runtime-bridge
intent: Add a Main-owned OpenClaw Gateway Relay Talk transport, transient Renderer audio and direct-transcript UI, OpenClaw-backed Agent consult handling, and developer-gated Models Realtime Talk configuration without adding a ClawX-owned durable transcript source.
touchedAreas:
  - harness/specs/tasks/add-realtime-talk.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/realtime-talk.md
  - harness/specs/rules/realtime-talk-openclaw-authority.md
  - harness/specs/rules/e2e-parallel-isolation.md
  - harness/reference/realtime-talk.md
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - harness/src/rules.mjs
  - shared/talk/**
  - shared/acp-chat/types.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/talk-api.ts
  - electron/services/openclaw-api.ts
  - electron/main/ipc-handlers.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/config-delivery.ts
  - electron/gateway/manager.ts
  - electron/main/index.ts
  - src/lib/talk/**
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/stores/realtime-talk.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - src/components/settings/TalkSettings.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Models/index.tsx
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/dashboard.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/talk-*.test.ts
  - tests/unit/talk-*.test.tsx
  - tests/unit/realtime-talk-*.test.ts
  - tests/unit/live-talk-transcript.test.tsx
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/developer-mode.spec.ts
  - docs/plans/2026-08-16-realtime-talk.md
  - docs/**
  - docs/specs/2026-08-16-realtime-talk-design.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A user starts and stops one Gateway Relay realtime Talk session from the selected non-heartbeat Chat session.
  - The Renderer never communicates with the OpenClaw Gateway directly; Main owns all Talk RPCs and Talk event routing.
  - Microphone capture uses the negotiated relay input rate, browser audio processing, and 4096-sample batches so normal speech is not lost to render-quantum-sized RPC backpressure.
  - Direct realtime transcripts are visible only while Talk is active and never become ClawX-owned durable history.
  - Agent consults use OpenClaw's existing chat.send path for the selected session and reappear only through ACP replay.
  - Completed consult-result correlation requires successful tool-result submission and the matching final tool result; provider audio and playback completion are recorded independently.
  - Because relay output boundaries omit a consult identifier, consults are serialized and ACP replay occurs only at the claimed audio's following playback-complete `audioDone` or mark without tearing down the relay.
  - The live direct transcript appends non-final provider deltas and treats each final as the authoritative replacement for its current role segment; an interrupted user segment remains pending until its final arrives.
  - Assistant preamble, progress, and final-result segments share one bubble for the current user turn, without using message-text similarity or elapsed-time guesses to infer identity, duplication, or turn ownership.
  - Talk locks ordinary text composition while active and restores the user's draft on every terminal path.
  - The developer-gated Models Realtime Talk tab configures only catalog-driven realtime provider/model selection and displays readiness state.
  - Developer mode gates the Sidebar Talk action and Models Realtime Talk tab; the tab shows all catalog providers, disables unconfigured providers, and opens the resolved OpenClaw config file for speaker voice and other provider-specific fields.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - issue-report-export-safety
  - gateway-readiness-policy
  - gateway-heartbeat-safety
  - openclaw-config-delivery
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - provider-default-invariant
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - sidebar-session-attention-authority
  - web-browser-security-and-lifecycle
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - realtime-talk-openclaw-authority
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts
  - pnpm harness validate --spec harness/specs/tasks/add-realtime-talk.md --since bd1aac8e
  - pnpm harness run --spec harness/specs/tasks/add-realtime-talk.md --since bd1aac8e --dry-run
  - pnpm run harness:ci
  - pnpm run lint:check
  - pnpm run typecheck
  - pnpm test
  - pnpm run build:vite
  - pnpm exec vitest run tests/unit/talk-api.test.ts tests/unit/talk-audio.test.ts tests/unit/realtime-talk-controller.test.ts tests/unit/realtime-talk-store.test.ts
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts tests/unit/host-services.test.ts tests/unit/gateway-event-dispatch.test.ts
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx tests/unit/talk-settings.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-model-picker.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Only gateway-relay is supported; client-owned WebRTC/provider WebSocket, video, dictation, recording, and a transport picker are absent.
  - Main validates Talk request payloads, owns provider-facing Gateway protocol calls, and forwards only active relaySessionId events to Renderer.
  - Renderer batches microphone capture into 4096-sample appends at the negotiated input rate and does not routinely discard render-quantum-sized frames under serialized RPC backpressure.
  - No ClawX Talk transcript ledger, sidecar history, cache, direct OpenClaw transcript write, or synthetic ACP history exists.
  - Direct-provider transcript UI is transient and clears on stop, session switch, ACP reload, and application restart.
  - Agent consult is started with talk.client.toolCall and shown after ACP reload from the existing OpenClaw transcript, never by a custom timeline projection; completed consult-result correlation requires successful tool-result submission and the matching final tool result.
  - Consult ACP replay does not tear down the relay before provider output playback completes; an unclaimed/no-audio mark never triggers replay.
  - The direct transcript appends declared deltas and replaces the current role segment with its declared final only in transient display state, never synthetic ACP history.
  - Interrupted user finals and assistant segment boundaries are tracked by event state rather than message-text similarity or elapsed-time heuristics; multiple assistant response segments remain in one bubble until a new user turn.
  - Developer mode gates the Sidebar Talk action and Models Realtime Talk tab. Disabling developer mode stops any active Talk relay so no hidden active session remains.
  - The Models Realtime Talk tab lists every realtime provider and model declared by the Gateway catalog, disables unconfigured providers with localized guidance, saves only provider/model, and opens the resolved OpenClaw config file for speaker voice and other provider-specific fields.
  - A consumed boundary never retries automatically after failure; preserved-replay failure keeps Talk active with an explicit localized retry action and permits no concurrent refresh.
  - New text is localized in en, zh, ja, and ru; the UI has an Electron E2E interaction test.
  - README English, Simplified Chinese, and Japanese documentation describe the feature and its history semantics.
  - The Talk scenario, authority rule, and reference define Gateway Relay-only transport, Main-owned configuration, and no ClawX-owned durable Talk history.
  - Talk readiness is displayed and checked before start; the tab configures provider/model only, while speaker voice and other provider-specific fields remain in the resolved OpenClaw config file.
  - Release validation records configured-provider macOS microphone permission, direct response, Agent consult, barge-in, stop, and Gateway reconnect results without claiming unperformed manual checks passed.
docs:
  required: true
---

`gateway-backend-communication` is the primary scenario so its task validation and changed-file ownership apply. `realtime-talk` is supplemental scope for the Talk-specific authority rule and renderer lifecycle contract.

Use `bd1aac8e`, the approved design commit immediately before Talk implementation, for this task's focused Harness diff validation. Normal `origin/main` comparisons and `pnpm run harness:ci` are baseline checks only: unrelated branch/worktree history can contaminate their changed-file range or structural result and must be reported separately.
