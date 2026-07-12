---
id: acp-file-activity
title: ACP OpenClaw File Activity
type: user-visible-flow
ownedPaths:
  - electron/services/files-api.ts
  - src/lib/acp/openclaw-file-activities.ts
  - src/components/file-preview/**
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - tests/unit/openclaw-file-activities.test.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/e2e/chat-file-changes.spec.ts
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - session-workspace-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
---

This scenario covers per-turn file buttons and summaries, session-level Changes, replay, and workspace-scoped Preview for successful OpenClaw `write`, `edit`, and `apply_patch` calls.

The UI represents tool-declared activity, not a verified filesystem or Git diff. Detailed input grammar, aggregation, and path safety are documented in `harness/reference/openclaw-file-activity.md`.
