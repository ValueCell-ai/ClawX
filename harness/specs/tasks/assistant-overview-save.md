---
id: assistant-overview-save
title: Save assistant overview settings together
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Make assistant name and default model editable as one overview draft, saved only by the dialog footer.
touchedAreas:
  - src/pages/Agents/**
  - tests/unit/agents-page.test.tsx
  - tests/e2e/agents-workspace-experience.spec.ts
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Editing name or selecting a model does not write until Save in the overview footer.
  - Saving validates and applies changed fields, closes on full success, and keeps unsaved drafts available after a failure.
  - Closing, canceling or navigating away with unsaved changes requires the existing discard confirmation.
  - Existing external model references remain unchanged unless a user selects a configured model and saves.
  - The selected model and provider are shown together in assistant creation and overview selectors.
  - SOUL.md is saved separately in the profile tab, with existing conflict detection and draft retention.
  - Starting a task remains available from the assistant list rather than the management dialog.
requiredProfiles:
  - fast
requiredRules:
  - assistant-workspace-identity
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/agents-page.test.tsx
  - tests/e2e/agents-workspace-experience.spec.ts
acceptance:
  - Opening, changing and canceling the picker never invokes a model update unless Save is pressed.
  - Name and model saves use existing host-api boundaries; no new migration or protocol is introduced.
  - Failed saves retain remaining drafts; a saved name is not silently undone when a subsequent model save fails.
  - No unfinished SOUL.md draft is discarded when overview settings are saved.
  - Tabs retain pending drafts and keyboard focus and discard confirmation continue to work.
docs:
  required: true
---

Overview fields are saved sequentially using the existing independent APIs, not as an atomic backend transaction. A partial failure must be reported without discarding the remaining draft.
