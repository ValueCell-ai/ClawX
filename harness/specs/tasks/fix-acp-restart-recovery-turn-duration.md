---
id: fix-acp-restart-recovery-turn-duration
title: Preserve whole-turn duration across Gateway restart recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep transcript-derived ACP whole-turn timing anchored to the original visible user prompt when OpenClaw inserts an internal restart-recovery user record.
touchedAreas:
  - electron/services/sessions-api.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - tests/unit/sessions-api-workspace.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/tasks/fix-acp-restart-recovery-turn-duration.md
expectedUserBehavior:
  - A turn recovered after an automatic Gateway restart continues to display elapsed time from the original user send.
  - When the recovered turn completes, its duration includes the outage and recovery interval instead of stopping at the last pre-restart tool result.
  - Internal OpenClaw recovery instructions never appear as independent timed user turns.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - gateway-heartbeat-safety
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --project=parallel --grep "restart-recovered historical duration"
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/fix-acp-restart-recovery-turn-duration.md
acceptance:
  - Main excludes transcript user records whose trusted provenance kind is `internal_system` or `inter_session` when it identifies visible user-turn boundaries.
  - Assistant and tool-result records after an internal restart-recovery instruction continue extending the preceding real user turn.
  - The extracted duration starts at the original real user record and ends at the final recovered assistant record.
  - Existing duplicate-from-tail alignment, bounded transcript reads, live timing, and ACP history authority remain unchanged.
  - Unit coverage reproduces the report shape: original user, pre-restart tool activity, internal restart-recovery user record, and final recovered assistant response.
  - Electron E2E verifies that the corrected multi-minute timing is rendered on the replayed ACP turn.
docs:
  required: false
---

## Incident

An accepted prompt produced tool activity, then the Gateway stopped responding to WebSocket pong and core RPC traffic. ClawX's three-minute liveness deadline and five-second verification probe intentionally restarted the owned Gateway. OpenClaw persisted an internal `role: user` recovery instruction with `provenance.kind: internal_system` before finishing the original turn.

The Main transcript timing extractor treated that internal instruction as a real user boundary. It therefore ended the visible turn at the last pre-restart tool result, producing roughly ten seconds even though the original prompt remained active for more than four minutes. Renderer initially retained the correct live timer, but post-settlement transcript reconciliation replaced it with the truncated historical duration.

## Scope

Correct only metadata timing boundaries. ACP replay remains authoritative for visible turns and content, restart recovery remains unchanged, and no transcript record is projected into Chat.
