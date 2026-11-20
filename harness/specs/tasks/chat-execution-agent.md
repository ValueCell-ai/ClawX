---
id: chat-execution-agent
title: Make the conversation execution agent explicit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace next-message agent targeting with explicit agent selection before sending while preserving canonical session ownership and typed ACP loading.
touchedAreas:
  - src/pages/Chat/**
  - src/components/layout/**
  - src/stores/chat.ts
  - src/stores/composer-drafts.ts
  - shared/chat/types.ts
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Unsent attachment previews sit inside the composer above the text area, stay removable, and clear after sending.
  - A named execution-agent selector replaces the at-mention target and updates model, skill scope and workspace before any message is sent.
  - Choosing another agent opens a fresh canonical task under that agent and carries unsent text and attachments without moving an existing conversation or sending a prompt.
  - The Agent picker contains agent selection rows with labeled default models, without a footer notice or main-conversation continuation action; existing conversations open from the sidebar.
  - Sending always uses the selected conversation and displayed workspace through the existing typed ACP boundary.
  - The toolbar no longer repeats an ambiguous passive agent badge; sidebar rows label non-default agents only, using the configured defaultAgentId and retaining ownership in every row's hover title.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - sidebar-session-attention-authority
  - session-workspace-authority
  - ui-i18n-design-tokens
  - docs-sync
  - comms-regression
requiredTests:
  - tests/e2e/chat-execution-agent.spec.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/i18n-locale-parity.test.ts
acceptance:
  - No next-message target can override the execution agent, workspace, or session at send time.
  - Fresh agent tasks never silently append to an existing main conversation; existing task histories remain owned by their original agent.
  - All four locales have complete selector labels and hints, and selection remains usable in compact windows.
  - Document and validate the selected ACP send path without adding renderer transport or direct IPC calls.
docs:
  required: true
---

Use existing canonical session selection and Host API / ACP loading. Do not change
Gateway-owned status, lineage, or delivery authority.
