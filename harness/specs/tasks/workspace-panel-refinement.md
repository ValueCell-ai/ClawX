---
id: workspace-panel-refinement
title: Unify workspace browsing and file preview
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Refine the existing workspace panel with one shared preview, discoverable file navigation and an accessible narrow-window drawer while preserving Host-owned file authority and session ownership.
touchedAreas:
  - src/**
  - shared/i18n/locales/**/chat.json
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Workspace files and conversation attachments share the current preview and file toolbar without file-type-specific tab jumps.
  - File search preserves parent folders, hidden files are opt-in, directories start collapsed and expansion is remembered per agent and workspace.
  - Current task files derive only from existing session file activities and recently opened files remain bounded and scoped to their workspace.
  - Tree and panel dividers support pointer and keyboard resizing; selected files and tab states are accessible.
  - Windows below 1024px use an accessible drawer with a visible close action, focus return and working preview fullscreen.
  - Existing text, HTML, Markdown and Office previews retain read-only behavior, scope-specific reads, size boundaries and a single active PPTX viewer.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - session-workspace-authority
  - office-preview-safety
  - docs-sync
requiredTests:
  - tests/e2e/workspace-panel.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/artifact-panel.test.tsx
acceptance:
  - No new backend transport, file routes, implicit permission changes or naked-path fallback is introduced.
  - Empty, filtered, stale, deleted and unavailable files have localized states rather than silent selection failures.
  - Agent and session changes cannot project another workspace's recent files or current task files into the new scope.
  - README documentation and scenario/rule coverage describe the final flow.
docs:
  required: true
---

The existing Host API owns reading, revealing and validating files. The Renderer only
reuses existing typed endpoints. The six home skill shortcuts from the preceding
UI work remain included in the pending diff and retain their existing behavior.
