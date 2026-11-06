---
id: fix-openclaw-2026-10-5-acp-restart
title: Restore ACP continuation and new-prompt admission through Gateway restarts on OpenClaw 2026.10.5
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep accepted ACP prompts attached to trusted native restart recovery and wait for the ACP-owned connection before admitting new prompts, with concrete sanitized errors.
touchedAreas:
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/openclaw-acp-restart-runtime.test.ts
  - tests/unit/openclaw-acp-readiness.test.ts
  - tests/unit/acp-error.test.ts
  - tests/unit/acp-chat-service.test.ts
  - electron/services/acp-chat-service.ts
  - electron/services/acp-error.ts
  - shared/acp-chat/types.ts
  - shared/i18n/locales/**/chat.json
  - src/stores/acp-chat-session.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - src/stores/chat.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - harness/specs/tasks/fix-openclaw-2026-10-5-acp-restart.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/tasks/verify-openclaw-patch-behavior-live.md
  - harness/reference/acp-chat.md
  - harness/reference/openclaw-patch-live-verification.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - An accepted prompt remains pending through the existing Main-computed managed-restart budget, while an unacknowledged send keeps its short disconnect deadline.
  - The replacement run is adopted only through explicit trusted recovery lineage, never from a matching session key alone.
  - Recovered text and tools reach the original live turn, cancellation targets the current run, and a recovered terminal settles the original prompt.
  - A transient Gateway catalog response does not navigate away from the running conversation.
  - New session operations and prompts wait for the ACP-owned authenticated connection after Gateway restart, with a default 60-second deadline and cancellation.
  - Protocol failures show a concrete sanitized reason and code, with a localized reconnect-timeout explanation.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/openclaw-acp-restart-runtime.test.ts
  - tests/unit/openclaw-acp-readiness.test.ts
  - tests/unit/acp-error.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
acceptance:
  - A real installed ACP process test covers disconnect/reconnect, accepted and unacknowledged deadlines, source-run validation, repeated recovery, tools, cancellation and terminal reconciliation.
  - The current native recovery admission and authorization architecture remains authoritative; retired request fields are not reintroduced.
  - Finite recovery timers and stale-response guards prevent indefinitely pending, cross-session or unrelated-run settlement.
  - A first prompt retains subscription interest before native session materialization, retries after acceptance, and retries transient reconnect subscription failures before recovered tool delivery.
  - Dependency patch registration and lock hashes match the installed runtime, whose modified chunks remain syntactically valid.
  - The user-confirmed sleep/restart scenario succeeds in the real ClawX UI with glm-5.3-flash after the fix.
  - Offline transcript-tail replay and compaction lifecycle repairs remain separate follow-ups.
  - Completed-turn regression tests hold ACP hello while the Gateway endpoint is available, covering fresh, loaded and retained sessions without consuming accepted/unacknowledged run recovery budgets.
  - Connection-generation guards, cancellation, supersession and shutdown prevent stale completion or later submission of a cancelled queued prompt; readiness rechecks share one finite admission deadline.
  - Concrete protocol reason extraction is bounded, excludes arbitrary request/config/headers data, and redacts credentials consistently before UI, log and trace delivery.
  - Timeout explanations cover en, zh, ja and ru, and Electron E2E verifies concrete error detail presentation.
  - The real ClawX strict-ready immediate-send flow succeeds without a manual delay; no possibly transmitted chat.send is automatically repeated.
docs:
  required: true
---

The user observed and confirmed the live failure before authorizing this fix.
See [the live verification report](../../reference/openclaw-patch-live-verification.md)
and ignored `restart-showcase-before-fix.json` evidence. This task covers accepted
run continuation and new-operation admission after restart; it does not bypass
ACP history authority in Renderer.

Validated on the real profile with `zai/glm-5.3-flash` in
`agent:main:session-1793142646764`: the managed restart took 12221 ms, the
conversation stayed selected, the linked successor's new tool reached completed
in ACP and ClawX, and the original prompt settled with `VERIFIED_RESTART_DONE`.
Ignored evidence: `artifacts/review/openclaw-restart-fix/live-verified.json`,
`live-verified.png` and `transcript-verified.json`.

Validation: 137 relevant unit tests across seven suites, the Electron restart E2E,
ESLint for changed source/tests, full typecheck, `comms:replay`, `comms:compare`,
task validation against HEAD, selected-flow dry run, and `harness:ci` passed.

The completed-turn reconnect admission repair also covers the independent ACP
connection's readiness and detailed error presentation. Its durable contract is
in [ACP connection readiness](../../reference/acp-chat.md#gateway-reconnect-admission-and-errors),
and the before/after real-model controls and final validation are recorded in
[the live verification report](../../reference/openclaw-patch-live-verification.md#gateway-重启后新一轮消息的入场与错误透出2026-10-30).
