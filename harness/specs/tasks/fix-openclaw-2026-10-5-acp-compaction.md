---
id: fix-openclaw-2026-10-5-acp-compaction
title: Restore compaction lifecycle delivery to ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Deliver native manual and automatic compaction lifecycle events to pending and loaded ACP sessions without changing the compaction algorithm.
touchedAreas:
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-acp-compaction-runtime.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/e2e/chat-acp-process-timeline.spec.ts
  - harness/specs/tasks/fix-openclaw-2026-10-5-acp-compaction.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/reference/acp-chat.md
  - harness/reference/openclaw-patch-live-verification.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Manual /compact shows one in-progress marker that becomes completed, failed or cancelled.
  - Automatic preflight, overflow and threshold compaction display their structured lifecycle.
  - A loaded conversation also receives external sessions.compact operations without a pending prompt.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-acp-compaction-runtime.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-restart-runtime.test.ts
  - tests/unit/openclaw-acp-offline-replay-runtime.test.ts
  - tests/e2e/chat-acp-process-timeline.spec.ts
acceptance:
  - Native producers publish a stable per-occurrence ID through start and terminal events, including abort and failure, without modifying compaction algorithms.
  - Exact-session message subscribers receive compact operations through existing authorized Gateway delivery, and combined global/exact subscriptions receive one copy.
  - Installed ACP subprocess tests cover pending/manual, automatic and passive loaded sessions, replay buffering, deduplication and wrong-session rejection.
  - Existing restart ownership, offline replay and normal parent ambient-text guards remain intact.
  - Real ClawX /compact shows an in-progress marker and a terminal marker in place after the user-confirmed reproduction.
docs:
  required: true
---

The user confirmed the real failure in `agent:main:session-1793146977431`:
native compaction completed in 33155 ms (19k to 477 tokens), while 100 ms DOM
sampling observed zero ACP compaction rows throughout. Evidence is under ignored
`artifacts/review/openclaw-compaction-showcase/`. See the
[live verification report](../../reference/openclaw-patch-live-verification.md).

Validated on the real profile with `zai/glm-5.3-flash`: `/compact` in
`agent:main:session-1793146977431` emitted start and completed metadata with
one ID and changed one visible row in place (about 47 seconds, 20k to 752
tokens). Re-entering kept one completed occurrence. An external RPC also
updated the passive loaded session through start and end.

35 relevant unit tests across six suites, the compaction Electron E2E and its
two prerequisites, full typecheck, changed-test ESLint, comms replay/compare,
task validation against HEAD, selected-flow dry run and harness CI passed.
Ignored evidence is in `artifacts/review/openclaw-compaction-fix/`.

A final real RPC subscription probe (120-second budget) completed successfully:
exact-only and global-plus-exact clients each received one start and one end;
another-session-only client received none. The passive ClawX view updated in
place. Renderer reload/reselection retained exactly the three new completed
occurrences from the manual command and two external RPC operations.
