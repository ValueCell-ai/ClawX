---
id: realtime-talk
title: Realtime Talk
type: runtime-bridge
ownedPaths:
  - shared/talk/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/talk-api.ts
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
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/LiveTalkTranscript.tsx
  - src/pages/Chat/index.tsx
  - src/components/settings/TalkSettings.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/talk-*.test.ts
  - tests/unit/talk-*.test.tsx
  - tests/unit/realtime-talk-*.test.ts
  - tests/unit/live-talk-transcript.test.tsx
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/developer-mode.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
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
  - gateway-readiness-policy
  - gateway-heartbeat-safety
  - openclaw-config-delivery
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - realtime-talk-openclaw-authority
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
---

Realtime Talk provides one global, Main-owned OpenClaw Gateway Relay session for the selected non-heartbeat Chat session. Renderer captures and plays transient audio, presents transient direct-provider text, and reaches Main only through the typed Host API and host-event interfaces.

Gateway Relay, relay lifecycle, configuration authority, and the direct-versus-Agent-consult history boundary are defined in `harness/reference/realtime-talk.md`. The ACP interaction remains subject to `harness/reference/acp-chat.md` and `harness/reference/openclaw-config-delivery.md`.

The Talk E2E uses test-local AudioContext and media-device mocks, so it does not require E2E_EXCLUSIVE_TAG because its audio/media mocks are local and do not mutate an OS-global resource.
