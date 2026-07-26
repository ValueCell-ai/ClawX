---
id: acp-whole-turn-duration
title: Show live and historical ACP whole-turn duration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Show one whole-turn duration for ACP assistant turns, using Renderer-observed timing while live and a Main-owned transcript timing supplement after historical ACP replay.
touchedAreas:
  - harness/specs/tasks/acp-whole-turn-duration.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/reference/acp-chat.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/turn-timings.ts
  - src/lib/acp/transcript-supplement.ts
  - src/lib/acp/timeline-groups.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/AcpTimeline.tsx
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/acp-turn-timings.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-timeline-groups.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A running ACP assistant turn shows elapsed whole-turn time without resetting when the user navigates away and returns.
  - A completed live turn freezes the observed duration when the ACP prompt settles.
  - Historical assistant turns show transcript-derived duration only when a bounded transcript turn aligns unambiguously with a turn already created by ACP replay.
  - Missing, stale, incomplete, or ambiguous transcript timing never creates or changes Chat content and leaves duration hidden.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts tests/unit/acp-turn-timings.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-chat-components.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/acp-whole-turn-duration.md
  - pnpm harness run --spec harness/specs/tasks/acp-whole-turn-duration.md
  - pnpm run harness:ci
acceptance:
  - ACP session/load replay remains the sole authority for historical turn existence, content, and ordering.
  - Main parses bounded OpenClaw transcript records and returns only timing candidates with normalized user anchors; Renderer never reads JSONL directly.
  - A code comment at the transcript timing entry point explains that ACP loadSession does not expose enough timestamps to calculate whole-turn duration, requiring transcript supplementation.
  - Historical timing uses the real user record as its start and the latest assistant or tool-result record before the next real user as its end, excluding internal inter-session user records.
  - Renderer aligns timing by normalized ACP prompt text and duplicate occurrence from the tail, and rejects missing or ambiguous matches.
  - Live timing starts with the optimistic user turn, survives the existing memory-only navigation snapshot, freezes on successful prompt settlement, and is removed with a failed optimistic turn.
  - Duration text is localized in English, Chinese, Japanese, and Russian and uses established muted metadata styling.
  - Unit, Electron E2E, typecheck, lint, build, communication regression, and harness validation pass.
docs:
  required: true
---

## Scope

This task adds metadata-only whole-turn timing to ACP Chat. Transcript records may annotate an ACP-replayed turn but may not manufacture timeline items or become a parallel history source.

## Out Of Scope

- Provider-side model latency, time-to-first-token, reasoning duration, and individual tool duration.
- Modifying OpenClaw or relying on its private ACP SQLite replay schema.
- Reconstructing missing ACP messages or process items from transcript content.
