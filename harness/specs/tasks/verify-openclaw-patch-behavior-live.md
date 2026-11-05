---
id: verify-openclaw-patch-behavior-live
title: Verify legacy OpenClaw patch guarantees through the real ClawX runtime
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Distinguish actual ClawX regressions from changed upstream mechanisms before changing the OpenClaw 2026.10.5 dependency patch.
touchedAreas:
  - harness/specs/tasks/verify-openclaw-patch-behavior-live.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/reference/openclaw-patch-live-verification.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
expectedUserBehavior:
  - Verification uses the real Electron Renderer and Main, ACP child and pinned Gateway with real model requests, without mocked ACP or Gateway events.
  - Dedicated test sessions in the user-authorized real profile keep test content separate from existing conversations; the user explicitly permits real Gateway restart experiments and model usage.
  - Each suspected regression has its trigger, native events, persisted state and visible outcome recorded; untriggered cases remain explicitly unverified.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - diagnostics-trace-safety
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-restart-recovery-patch.test.ts tests/unit/openclaw-acp-stream-patch.test.ts tests/unit/openclaw-acp-ambient-stream.test.ts tests/unit/openclaw-acp-compaction-patch.test.ts tests/unit/openclaw-compaction-tail-patch.test.ts
acceptance:
  - Exercise accepted prompt disconnect and recovered-run settlement, cancellation tail delivery, complete-ledger reload after out-of-band completion, fresh-session subagent delivery, tool-result pressure, and manual compaction visibility through the real application.
  - Use the user-authorized glm-5.3-flash model; never include provider credentials or complete personal configuration in evidence.
  - Keep dependency patches unchanged during diagnosis and identify which remaining fixes need new behavioral coverage.
  - Durable findings separate successful reproduction, upstream compensation, and cases whose necessary trigger was not achieved.
docs:
  required: true
---

Evidence-only compatibility investigation. Live observations and patch decisions
are recorded in [the live verification reference](../../reference/openclaw-patch-live-verification.md).
Generated traces and screenshots stay under ignored `artifacts/review/`.
