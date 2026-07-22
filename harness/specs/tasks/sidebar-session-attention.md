---
id: sidebar-session-attention
title: Show Gateway-authoritative sidebar session attention
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Show active and unread-completion state in sidebar session rows using the OpenClaw Gateway session catalog as the only status authority.
touchedAreas:
  - harness/reference/sidebar-session-attention.md
  - harness/specs/tasks/sidebar-session-attention.md
  - harness/specs/rules/sidebar-session-attention-authority.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - tests/unit/harness-specs.test.ts
  - shared/chat/types.ts
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/chat/session-label-hydration.ts
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-catalog.test.ts
  - src/stores/chat.ts
  - src/stores/gateway.ts
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/gateway-bisection-0d794cd.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/session-label-hydration.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - harness/reference/chat-workspace-and-navigation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A sidebar session shows a loading indicator while its exact Gateway session row is active.
  - An observed completion outside the visible Chat session shows an unread indicator until the conversation is opened.
  - The visible Chat session remains read when its active run completes, while retaining a current session on another route does not mark it read.
  - Reconnect hydration and persisted observed-busy state recover only transitions that ClawX can prove from Gateway session rows.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-events-fallback-policy
  - gateway-readiness-policy
  - ui-i18n-design-tokens
  - sidebar-session-attention-authority
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/session-attention.test.ts tests/unit/session-status.test.ts tests/unit/session-catalog.test.ts tests/unit/session-label-hydration.test.ts tests/unit/gateway-events.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/sidebar-session-buckets.test.ts
  - pnpm exec vitest run tests/unit/i18n-locale-parity.test.ts tests/unit/gateway-event-dispatch.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-sidebar-session-attention.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/sidebar-session-attention.md
  - pnpm harness run --spec harness/specs/tasks/sidebar-session-attention.md
acceptance:
  - Sidebar busy and completion state comes only from exact-key OpenClaw Gateway session rows; ACP prompt state, ACP timeline events, and Gateway agent runtime events are never secondary authorities.
  - Gateway connection epochs, canonical list hydration, ordered event replay, and per-key timestamps fence stale list and event results from replacing newer state.
  - Busy replaces the relative timestamp, unread completion replaces busy, and a read conversation restores the relative timestamp.
  - Unread clears only when the user opens the conversation or that conversation is visibly mounted in Chat; retaining its key on another route does not clear it.
  - Exact-key observed-busy and unread state persists across restart without inferring unread from updatedAt or an entirely unobserved offline run.
  - Run-scoped cron keys do not drive base-row busy or unread attention until the Gateway exposes a canonically recoverable projection.
docs:
  required: true
---

## Scope

The implementation preserves the Main-owned Gateway transport and the existing Renderer session catalog. It adds only a Gateway-derived run projection and local presentation attention state.

The durable architecture, ordering and failure semantics, current limitations, and future Gateway-unread migration are documented in `harness/reference/sidebar-session-attention.md`.

## Out Of Scope

- Modifying OpenClaw or upgrading the bundled OpenClaw dependency.
- Using ACP or Gateway agent runtime events as a second sidebar status source.
- Guessing unread completion from activity timestamps or unrecoverable run-scoped cron activity.
