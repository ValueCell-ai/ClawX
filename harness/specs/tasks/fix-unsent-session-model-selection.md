---
id: fix-unsent-session-model-selection
title: Preserve model selections before the first conversation prompt
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep automatically prepared ACP sessions as local drafts until first prompt dispatch so selecting a model does not mistake an unsent session for a persisted Gateway row.
touchedAreas:
  - harness/specs/tasks/fix-unsent-session-model-selection.md
  - harness/specs/rules/provider-model-selection-authority.md
  - harness/reference/acp-chat.md
  - src/pages/Chat/index.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
expectedUserBehavior:
  - A conversation prepared automatically before its first prompt retains a selected model for that first prompt.
  - Selecting a model does not create an unsent conversation in Gateway storage.
  - A previously persisted conversation deleted elsewhere cannot be recreated by a model selection.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-model-selection-authority
requiredTests:
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - ACP session preparation alone does not acknowledge a local draft as persisted.
  - The first prompt applies the staged model with explicit creation permission before dispatch.
  - Existing-session writes retain the Main-owned missing-row and identity guards.
  - Focused unit tests, Electron E2E, harness validation, communication replay, and communication compare pass.
docs:
  required: false
---

## Scope

Preserve the existing local-draft marker during automatic ACP preparation. This
does not infer creation permission from missing session IDs or relax Main's
protection against recreating a deleted conversation.

The README files already describe model selection for each conversation; this
fix restores that behavior. The ACP reference and selection rule record the
distinction between in-memory ACP preparation and persisted Gateway sessions.
