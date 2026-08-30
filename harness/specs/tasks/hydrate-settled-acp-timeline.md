---
id: hydrate-settled-acp-timeline
title: Hydrate settled ACP turns from authoritative replay
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace a completed live ACP timeline atomically with session/load replay so dropped live chunks cannot leave a permanently truncated reply.
touchedAreas:
  - docs/en-US/architecture.md
  - docs/zh-CN/architecture.md
  - docs/ja-JP/architecture.md
  - docs/ru-RU/architecture.md
  - harness/specs/tasks/hydrate-settled-acp-timeline.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Assistant output remains live while an ACP prompt is running.
  - After a successful prompt settles, the complete ACP session/load replay replaces the live timeline in one Renderer state commit.
  - A dropped trailing live chunk becomes visible without switching conversations or exposing a blank loading state.
  - A failed, stale, or superseded settled replay leaves the current live timeline unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --grep "hydrates a settled assistant reply"
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Settled hydration starts only after session/prompt returns success and uses the existing typed host-api session/load operation; Renderer does not read raw transcript prose or Gateway final text.
  - The live timeline remains committed and visible while settled replay is in flight.
  - Replay notifications are filtered to the returned session and generation, reduced from an empty timeline with the ordinary ACP reducer, and published atomically only after the replay load succeeds.
  - The replay generation and complete replay timeline replace the settled live generation and timeline together.
  - Session changes, newer loads, newer prompts, failed replay, resumed-active-prompt responses, and empty replay batches cannot overwrite the settled live timeline.
  - A successful empty or resumed replay adopts Main's committed routing generation without replacing visible live items.
  - Existing attachment resolution, image-generation compatibility projections, and transcript-derived timing remain best-effort supplements after ACP replay is committed.
  - Typed compaction failure codes and bounded reasons in authoritative replay survive the atomic timeline replacement without transcript inference.
docs:
  required: true
---

## Scope

ACP session/update chunks remain the only source of live Chat text. ACP session/load replay is the settled history authority and is used once after a successful prompt to converge the in-memory timeline without a visible reload. This task does not add a transcript text fallback, Gateway text projection, persisted Renderer cache, or replacement heuristic between unrelated text sources.
