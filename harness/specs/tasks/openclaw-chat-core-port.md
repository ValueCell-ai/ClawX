---
id: openclaw-chat-core-port
title: Port OpenClaw Chat Core semantics into the ClawX Chat surface
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the visible ClawX Chat UI's ClawX-specific event/rendering protocol with an OpenClaw-compatible chat core and React surface while preserving the Electron Main-owned host API boundary and ClawX visual conventions.
touchedAreas:
  - harness/specs/tasks/openclaw-chat-core-port.md
  - docs/superpowers/plans/2026-06-19-openclaw-chat-core-port.md
  - docs/superpowers/plans/2026-06-20-openclaw-chat-p0-p1-parity.md
  - docs/superpowers/specs/2026-06-19-openclaw-chat-core-port-design.md
  - docs/superpowers/specs/2026-06-20-openclaw-chat-p0-p1-design.md
  - electron/gateway/**
  - electron/gateway/event-dispatch.ts
  - electron/gateway/ws-client.ts
  - electron/main/ipc-handlers.ts
  - electron/main/index.ts
  - electron/main/tray.ts
  - electron/preload/index.ts
  - electron/services/**
  - electron/shared/providers/model-capabilities.ts
  - electron/utils/**
  - shared/chat-runtime-events.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - shared/i18n/locales/*/common.json
  - src/chat-core/openclaw-port/**
  - src/chat-core/clawx-adapter/**
  - src/components/layout/Sidebar.tsx
  - src/lib/host-events.ts
  - src/pages/Chat/**
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/stores/openclaw-chat-surface.ts
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/menu.json
  - tests/e2e/chat-*.spec.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - tests/e2e/gateway-lifecycle.spec.ts
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/e2e/chat-openclaw-core.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/chat-scroll-pin-bottom.spec.ts
  - tests/e2e/chat-scroll-to-latest.spec.ts
  - tests/e2e/chat-skill-trigger-i18n.spec.ts
  - tests/unit/chat-history-reply-while-sending.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-leading-orphan-tools.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-tool-card-suppression.test.tsx
  - tests/unit/*.test.ts
  - tests/unit/*.test.tsx
  - tests/unit/gateway-agent-events.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/openclaw-chat-core-adapter.test.ts
  - tests/unit/openclaw-chat-core-reducer.test.ts
  - tests/unit/openclaw-chat-message-extraction.test.ts
  - tests/unit/openclaw-chat-surface-render.test.tsx
  - tests/unit/openclaw-chat-surface-store.test.ts
  - tests/unit/slash-command-executor.test.ts
expectedUserBehavior:
  - Chat history renders from the OpenClaw-compatible chat surface without duplicating user messages.
  - Gateway agent event payloads reach Renderer in an upstream-shaped form; visible Chat rendering does not depend on ClawX ChatRuntimeEvent as its source of truth.
  - Tool calls render as reusable expandable tool cards with input and output details.
  - Slash command support exposes Skills via the Chat composer path.
  - Runtime compaction, fallback, and approval requests render in the Chat surface, and approval decisions flow back through hostApi-backed Gateway RPC.
  - Existing ClawX attachment semantics remain unchanged: images use base64 payloads and other attachments pass paths through the current composer/send path.
  - Existing question directory and scroll-to-latest behavior continue to work on the OpenClaw surface.
  - Thinking/reasoning output renders separately from normal assistant replies.
  - Assistant final_answer content is preferred over commentary content when displaying final replies.
  - Live tool, command_output, and patch agent streams render before history polling catches up.
  - Lifecycle aborted/cancelled events clear sending and abortable UI state.
  - The running state appears as a composer-adjacent pulse labeled "AI 回复中" instead of a full-width message row.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts tests/unit/openclaw-chat-core-reducer.test.ts
  - pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
  - pnpm run typecheck:web
  - pnpm exec vitest run tests/unit/openclaw-chat-core-reducer.test.ts tests/unit/openclaw-chat-surface-render.test.tsx tests/unit/openclaw-chat-surface-store.test.ts tests/unit/chat-input.test.tsx tests/unit/slash-command-executor.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-openclaw-core.spec.ts tests/e2e/chat-skill-trigger-i18n.spec.ts tests/e2e/chat-question-directory.spec.ts tests/e2e/chat-scroll-to-latest.spec.ts tests/e2e/chat-scroll-pin-bottom.spec.ts tests/e2e/chat-run-state-events.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer page/component code uses host-api, api-client, or host-events and does not introduce direct IPC, Gateway HTTP, or Gateway WebSocket calls.
  - Main forwards upstream-shaped Gateway agent events to Renderer for Chat consumption.
  - The visible Chat message list is rendered by the OpenClaw-compatible surface/store path, not by the legacy hidden ClawX execution graph renderer.
  - Tool cards, slash Skills, compaction, fallback, and approval states have focused unit or E2E coverage.
  - Communication replay and comparison pass without changing the accepted baseline.
docs:
  required: true
---
