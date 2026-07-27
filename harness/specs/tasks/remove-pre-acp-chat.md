---
id: remove-pre-acp-chat
title: Remove pre-ACP Chat implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the superseded pre-ACP Chat history, send, runtime-state, and visualization pipeline while preserving ACP Chat, bounded image-generation compatibility, and session-management behavior.
touchedAreas:
  - AGENTS.md
  - package.json
  - harness/specs/tasks/**
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/specs/rules/host-events-fallback-policy.md
  - harness/specs/rules/sidebar-session-attention-authority.md
  - harness/reference/acp-chat.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/reference/sidebar-session-attention.md
  - shared/acp-chat/**
  - shared/chat/**
  - shared/chat-runtime-events.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/chat-runtime-events.ts
  - electron/gateway/client.ts
  - electron/gateway/manager.ts
  - electron/gateway/rpc-backpressure.ts
  - electron/main/index.ts
  - electron/main/ipc/**
  - electron/main/ipc-handlers.ts
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - electron/services/gateway-api.ts
  - src/lib/acp/**
  - src/lib/generated-files.ts
  - src/components/file-preview/**
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/stores/**
  - src/pages/Chat/**
  - src/components/layout/Sidebar.tsx
  - src/styles/globals.css
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/**
  - tests/e2e/**
  - tests/e2e/fixtures/**
  - tests/e2e/chat-acp-process-timeline.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Opening or revisiting a normal conversation renders its history only from ACP session/load replay, with the existing bounded ACP transcript supplements retained.
  - Sending and stopping from the composer use only ACP session/prompt and session/cancel.
  - ACP text, thinking, tools, permissions, plans, attachments, generated files, generated images, and errors continue to render through the ACP timeline without the legacy ChatMessage or Execution Graph pipeline.
  - Session discovery, sidebar ordering and attention, title hydration, history supplementation, selection, deletion, and rename continue to behave as before.
  - Catalog reconciliation repairs removed selections atomically, resets suppression and timestamp fences across Gateway generations, withholds a selected persisted session until its workspace summary settles, and never overwrites a newer local catalog or selection mutation with the delayed snapshot.
  - A failed hard delete keeps the session and confirmation dialog intact; navigation and dialog closure happen only after host-confirmed deletion.
  - Bulk deletion repairs a deleted current selection atomically with the remaining catalog, preferring a valid non-cron/non-channel session or creating an agent-local placeholder.
  - Asynchronous OpenClaw image-generation completions continue to appear when accepted by the existing bounded ACP compatibility checks.
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
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - attachment-access-safety
  - diagnostics-trace-safety
  - session-workspace-authority
  - sidebar-session-attention-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/chat-toolbar.test.tsx
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/session-catalog.test.ts tests/unit/chat-load-sessions-startup.test.ts tests/unit/chat-session-management.test.ts tests/unit/chat-session-selection.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/sidebar-session-buckets.test.ts
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts tests/unit/host-services.test.ts tests/unit/gateway-event-dispatch.test.ts
  - pnpm exec vitest run tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-ws-trace.test.ts tests/unit/stores.test.ts
  - pnpm exec vitest run tests/unit/generated-files.test.ts tests/unit/file-preview-body.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/openclaw-file-activities.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-run-state-events.spec.ts tests/e2e/chat-acp-process-timeline.spec.ts tests/e2e/chat-sidebar-session-attention.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm harness validate --spec harness/specs/tasks/remove-pre-acp-chat.md
  - pnpm run harness:ci
  - git diff --check
acceptance:
  - ACP session/load replay is the only normal Chat history render path; no Gateway Chat history, transcript reconstruction, legacy message array, or persisted parallel replay ledger renders ordinary Chat turns.
  - ACP session/prompt and session/cancel are the only active composer send and stop paths; ACP permission responses remain a separate protocol action.
  - Legacy ChatMessage, Execution Graph, task visualization, RawMessage rendering helpers, and useChatStore send/runtime state and actions are removed from production code and their legacy-only tests are deleted or replaced with ACP assertions.
  - ACP-owned in-memory prompt state, including sending, cancelling, optimistic user segments, retained live prompt snapshots, and generation guards, remains intact.
  - gateway:chat-message and chat:runtime-event contracts, Main forwarding, and Renderer subscriptions remain only where required for bounded ACP image-generation completion compatibility; they do not feed ordinary messages, history, composer state, tool state, task visualization, or session run state.
  - Existing image-generation compatibility continues to require matching ACP session, generation, recent image_generate context, trusted completion evidence, deduplication, and stale-result rejection.
  - Session catalog, sidebar and attention state, ACP history supplements, automatic title hydration, session selection, hard delete, and rename behavior remain supported without depending on removed legacy message or runtime state.
  - Session deletion or hiding never leaves a dangling current selection; fallback selection follows the normal non-cron/non-channel policy or creates a fresh agent-local placeholder.
  - Single and bulk deletion use the same current-selection repair policy and never select a cron/channel survivor implicitly or leave the absent default key selected.
  - Selected persisted sessions with missing workspace identity are not published to ACP consumers before batched summary hydration settles, and stale summaries remain fenced by Gateway generation, session incarnation, and a local session catalog/selection mutation revision.
  - The unreachable chat media-send shared/Main/Renderer contract is removed; ACP load, prompt, cancel, and permission operations remain the exact typed Chat host actions.
  - The unused standalone Gateway client and Chat-history-only RPC backpressure layer are removed; typed generic Gateway RPC validates the same method and timeout inputs before delegating directly to GatewayManager.rpc.
  - Generic Gateway RPC diagnostics and proxy tests use non-Chat methods; one Electron E2E assertion prevents ordinary Chat from resurrecting a chat.history call.
  - No OpenClaw source, installed package source, bundled OpenClaw distribution, or OpenClaw patch is modified.
  - Typecheck, focused ACP and host tests, relevant ACP Electron E2E, communication regression checks, task validation, and harness CI pass.
docs:
  required: true
---

## Scope

Delete the pre-ACP Chat implementation after separating the session catalog and session-management responsibilities that are still consumed by ACP Chat. Remove legacy renderer history reduction, Gateway send orchestration, runtime send state, Execution Graph/task derivation, and their dead contracts, services, localization, and tests.

Keep the ACP timeline and composer as the sole normal Chat implementation. Preserve only the explicitly bounded Gateway-event bridge needed to project asynchronous image-generation completion evidence into the ACP timeline.

## Preserved Boundaries

- ACP `session/load`, `session/prompt`, `session/cancel`, `session/update`, and `session/request_permission` retain their existing Main/Renderer ownership and generation guards.
- The existing transcript-derived ACP supplements remain bounded to approved generated-media and attachment content plus metadata-only timing; they do not become a second ordinary history path.
- Session catalog, sidebar attention, workspace binding, title hydration, selection, deletion, and rename remain independent of legacy message rendering and runtime send state.

## Out Of Scope

- Modifying OpenClaw source, package contents, or bundled runtime behavior.
- Replacing ACP replay with Gateway Chat history or broad transcript reconstruction.
- Removing or widening the bounded ACP image-generation completion compatibility path.
- Redesigning the ACP timeline, composer, sidebar, workspace, attachment, permission, or file-activity experiences.
