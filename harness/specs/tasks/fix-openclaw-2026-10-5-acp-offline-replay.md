---
id: fix-openclaw-2026-10-5-acp-offline-replay
title: Restore offline transcript tails in native ACP history replay
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reconcile a complete ACP ledger with newer native transcript records so offline completion messages survive session switching, subsequent prompts and process reloads.
touchedAreas:
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-acp-offline-replay-runtime.test.ts
  - tests/unit/openclaw-acp-ambient-stream.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - harness/specs/tasks/fix-openclaw-2026-10-5-acp-offline-replay.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/reference/acp-chat.md
  - harness/reference/openclaw-patch-live-verification.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Returning to a conversation shows completion messages produced while another conversation held the ACP subscription.
  - Restored text, thoughts and tool boundaries remain present exactly once after another load, a subsequent prompt and a fresh ACP process.
  - Existing ledger order remains authoritative and failed transcript reads leave that replay available.
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
  - tests/unit/openclaw-acp-offline-replay-runtime.test.ts
  - tests/unit/openclaw-acp-ambient-stream.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
acceptance:
  - The installed ACP subprocess reconciles the user-confirmed legacy complete-ledger case through bounded native sessions.get and atomically persists eligible tail records in its own ledger.
  - Finite native commit timestamps and durable transcript identities bound import; ledger content is never replaced by transcript comparison or reordered.
  - Repeated records, buffered live events and concurrent ledger changes do not duplicate imported text or tools; fetch failures and invalid timestamps do not poison replay.
  - The subscription-before-replay transaction and Main/Renderer session and generation guards remain intact, with no Renderer transcript-content bypass.
  - The existing failed conversation is repaired without deleting its ledger; a fresh real glm-5.3-flash background completion also replays after switching away.
  - Missing content inside already-covered ledger intervals and compaction lifecycle delivery remain separate issues.
docs:
  required: true
---

The user confirmed the visible difference in real ClawX before authorizing this
repair. Before-fix evidence is under ignored
`artifacts/review/openclaw-offline-replay-showcase/`: parent session
`agent:main:session-1793142847299` has a persisted native announcement containing
`OFFLINE_CHILD_FINISHED_20261028`, while its complete ACP ledger and reloaded
ClawX timeline lack that reply. See the [live verification report](../../reference/openclaw-patch-live-verification.md).


Validated against the real profile with `zai/glm-5.3-flash`:

- Existing failure `agent:main:session-1793142847299`: all 11 original ledger
  events remain unchanged; two native tail updates restore the missing completion.
  The response survives application/ACP restart and re-entry exactly once.
- Fresh case `agent:main:session-1793143785992`: switched away at 1793143826666;
  the native announcement completed at 1793143880775 while ACP was on another
  session. Returning restores `REPLAY_FIX_CHILD_DONE_20261028`; repeated loads
  and Renderer reload followed by reselection keep one completion paragraph.
- 29 relevant unit tests in five suites, the Electron offline replay E2E, changed
  test ESLint, full typecheck, comms replay/compare, task validation against HEAD,
  selected-flow dry run and harness CI passed.

Ignored evidence: `artifacts/review/openclaw-offline-replay-fix/`, including the
legacy prefix-preservation snapshots, fresh native/ACP events, SQLite snapshots
and the final screenshot. Compaction lifecycle repair remains a later task.
