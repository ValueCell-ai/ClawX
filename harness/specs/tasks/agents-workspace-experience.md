---
id: agents-workspace-experience
title: Present persistent assistants through their work style and workspace
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Make configured OpenClaw agents understandable as persistent assistants, with native instructions, shared file reading and an explicit start-task action.
touchedAreas:
  - src/pages/Agents/**
  - src/lib/agent-workspace.ts
  - src/stores/agents.ts
  - src/stores/chat.ts
  - src/stores/composer-drafts.ts
  - src/types/attachment.ts
  - src/pages/Chat/ChatInput.tsx
  - src/components/file-preview/FilePreviewOverlay.tsx
  - src/components/ui/select.tsx
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/agents.json
  - electron/services/agents-api.ts
  - electron/utils/agent-config.ts
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Standard management headers remain aligned; compact assistant cards expose native work-style summaries, workspace and a start-task action.
  - Starting a task selects the exact configured agent and its workspace, preserves an unsent draft and does not send a prompt automatically.
  - A single centered detail dialog provides editable names, native SOUL.md instructions, same-layer model selection and read-only workspace/memory file entries.
  - Files open in the shared Workspace reader's right drawer and restore focus and detail scroll on close.
  - Optional creation instructions seed SOUL.md in the new managed workspace; copying initial settings remains a one-time copy without copying conversations or long-term memory.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - assistant-workspace-identity
  - shared-file-reader
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/agents-page.test.tsx
  - tests/unit/agent-config.test.ts
  - tests/unit/agent-workspace.test.ts
  - tests/unit/composer-drafts.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/e2e/agents-workspace-experience.spec.ts
  - tests/e2e/agent-deletion.spec.ts
  - tests/e2e/chat-execution-agent.spec.ts
acceptance:
  - Assistant summaries come from real native instructions, with honest missing/unavailable states and no invented personas or activity.
  - All backend calls use host-api or its file client; existing file authorization, read-only and size limits remain authoritative.
  - New instructions remain native workspace content, not parallel UI-only role metadata; creation errors retain the existing provisioning rollback.
  - Model editing uses configured models and shared Radix controls in the same dialog, while unknown existing overrides remain visible.
  - Controls have localized names, visible keyboard focus and bounded narrow-window layouts; deletion protections remain intact.
docs:
  required: true
---

See harness/reference/markdown-rendering.md for instruction previews and harness/reference/chat-workspace-and-navigation.md for task ownership.
