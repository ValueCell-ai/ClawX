---
id: remove-realtime-talk
title: Remove unavailable Realtime Talk voice input
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove ClawX's unavailable Realtime Talk microphone UI, transient audio pipeline, and dedicated Renderer/Main/Gateway bridge while preserving chat audio attachments, generic Gateway communication, and OpenClaw channel voice dependencies.
touchedAreas:
  - harness/specs/tasks/remove-realtime-talk.md
  - harness/specs/tasks/add-realtime-talk.md
  - harness/specs/tasks/model-management-consolidation.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/realtime-talk.md
  - harness/specs/rules/e2e-parallel-isolation.md
  - harness/specs/rules/realtime-talk-openclaw-authority.md
  - harness/reference/realtime-talk.md
  - harness/src/**
  - shared/talk/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/services/talk-api.ts
  - electron/main/ipc-handlers.ts
  - electron/main/index.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron-builder.yml
  - src/lib/talk/**
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/stores/realtime-talk.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - src/components/settings/TalkSettings.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Models/index.tsx
  - src/styles/globals.css
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/dashboard.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/**
  - tests/e2e/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/**
expectedUserBehavior:
  - ClawX no longer shows a microphone action, Realtime Talk model tab, listening state, live voice transcript, or Talk configuration.
  - ClawX no longer requests microphone permission or starts a realtime audio relay.
  - Text chat and audio-file attachments continue to work.
  - Generic Main-owned Gateway communication and OpenClaw channel voice support remain unchanged.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/remove-realtime-talk.md
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm run lint:check
  - pnpm run typecheck
  - pnpm test
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/developer-mode.spec.ts tests/e2e/chat-model-picker.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - No production source exposes or implements the ClawX Realtime Talk feature or its dedicated typed host/event contracts.
  - No Talk-specific microphone permission, locale key, model tab, transcript UI, audio capture/playback code, or test remains.
  - Chat audio attachments and OpenClaw Discord voice dependencies are retained.
  - Gateway event routing and shutdown behavior remain valid after the dedicated Talk relay path is removed.
  - The obsolete add-realtime-talk task is deleted, and surviving task specs neither require deleted Talk scenarios/rules nor prescribe restoring the feature.
  - Harness validation rejects task specs that reference missing primary or supplemental scenarios or required rules.
  - English, Simplified Chinese, and Japanese documentation no longer advertise Realtime Talk.
  - Electron E2E coverage proves developer mode no longer exposes the removed entry points.
docs:
  required: true
---

Use this task spec when removing or auditing the former ClawX-owned Realtime Talk voice-input subsystem.
