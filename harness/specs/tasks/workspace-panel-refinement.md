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
  - Workspace navigation always shows the complete directory tree, with a single-line directory title inside the navigation column and tooltip descriptions for hidden-file and collapse controls.
  - The preview begins directly below the panel tabs with a compact single-line path heading: a muted, truncatable directory prefix followed by the prioritized file name; directory and preview headers align side by side.
  - Tree and panel dividers support pointer and keyboard resizing; selected files and tab states are accessible.
  - Windows below 1024px use an accessible drawer with a visible close action, focus return and no preview maximize or redundant browse-file actions.
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
  - Agent and session changes keep directory expansion and hidden-file preferences scoped to their workspace.
  - README documentation and scenario/rule coverage describe the final flow.
docs:
  required: true
---

The existing Host API owns reading, revealing and validating files. This UI simplification
removes the task/recent filters and fullscreen overlay without changing file authority.
