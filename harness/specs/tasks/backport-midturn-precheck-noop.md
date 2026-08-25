---
id: backport-midturn-precheck-noop
title: Backport safe mid-turn precheck continuation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent already-capped mid-turn tool results from manufacturing a context overflow and unnecessary compaction while preserving retry budget for real tool progress.
touchedAreas:
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - harness/specs/tasks/backport-midturn-precheck-noop.md
  - harness/specs/rules/compaction-context-progress.md
  - tests/unit/openclaw-compaction-tail-patch.test.ts
expectedUserBehavior:
  - A tool-heavy active turn continues from the persisted transcript when live prompt estimation finds reducible tool output but persisted recovery reports that no oversized or aggregate tool results remain.
  - The no-op continuation does not trigger automatic compaction before the provider has rejected the persisted prompt.
  - Successful tool progress during a no-op continuation does not exhaust the run retry budget.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - compaction-context-progress
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-compaction-tail-patch.test.ts
acceptance:
  - Only the exact no oversized or aggregate tool results outcome is treated as a handled truncate-only no-op; empty sessions and truncation errors retain compaction fallback.
  - The retry uses the existing mid-turn transcript continuation path without rewriting persisted history or repeating the original user message.
  - A handled truncate-only no-op refunds its run-loop attempt only when the attempt contains at least one non-error tool result.
  - A genuine provider context rejection after the continuation still enters normal overflow compaction recovery.
docs:
  required: false
---

## Background

OpenClaw 2026.7.1-2 estimates mid-turn pressure from the live in-memory prompt
view but applies recovery truncation to the persisted session branch. Persistence
may already have capped the same tool results, so the two views can legitimately
disagree. Upstream PR openclaw/openclaw#117963 treats that exact no-op as a safe
continuation instead of manufacturing an overflow and compaction.
