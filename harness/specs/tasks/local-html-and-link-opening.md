---
id: local-html-and-link-opening
title: Unify local HTML and web link opening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Open local HTML files in ClawX by default while routing ordinary HTTP(S) link activation to the system browser and preserving an explicit internal-browser choice.
touchedAreas:
  - harness/specs/tasks/local-html-and-link-opening.md
  - harness/specs/tasks/web-browser.md
  - harness/specs/tasks/office-document-preview.md
  - harness/specs/rules/web-browser-security-and-lifecycle.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/specs/rules/office-preview-safety.md
  - harness/reference/web-browser.md
  - harness/reference/office-document-preview.md
  - shared/web-browser.ts
  - shared/host-api/contract.ts
  - shared/i18n/resources.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - package.json
  - pnpm-lock.yaml
  - electron/main/web-browser-policy.ts
  - electron/main/index.ts
  - electron/services/web-browser-api.ts
  - src/lib/host-api.ts
  - src/lib/local-html-browser.ts
  - src/components/common/BrowserLink.tsx
  - src/components/file-preview/MarkdownPreview.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/web-browser/WebBrowserHome.tsx
  - src/components/web-browser/WebBrowserHost.tsx
  - src/components/web-browser/WebBrowserToolbar.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/pages/Chat/AcpFileCard.tsx
  - src/pages/Chat/AcpMessageSegment.tsx
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/browser-link.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/web-browser-api.test.ts
  - tests/unit/web-browser-policy.test.ts
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/web-browser-controls.test.tsx
  - tests/unit/web-browser-host.test.tsx
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/web-browser-navigation.spec.ts
  - tests/e2e/web-browser-policy.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Activating an available local `.html` or `.htm` attachment, file-activity row, or Workspace tree node opens its file URL in ClawX Web Browser by default.
  - HTTP(S) links rendered by ClawX in Chat, Markdown preview, and execution details appear as ordinary text and cannot be clicked or opened from a context menu.
  - HTTP(S) links inside local HTML and pages shown in ClawX Web Browser open in the system browser on ordinary activation; right-clicking offers explicit internal and external actions.
  - Relative and explicit hostless file links from local HTML stay inside ClawX, while unsupported schemes remain blocked.
  - Previewing a non-HTML file hides the Web Browser tab so a previously opened page is not presented as related to the selected file.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - ui-i18n-design-tokens
  - web-browser-security-and-lifecycle
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/local-html-and-link-opening.md
  - pnpm exec vitest run tests/unit/browser-link.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/web-browser-api.test.ts tests/unit/web-browser-policy.test.ts tests/unit/i18n-locale-parity.test.ts tests/unit/harness-specs.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/web-browser-navigation.spec.ts tests/e2e/web-browser-policy.spec.ts --workers=1
acceptance:
  - The default internal-file route is extension-authoritative and applies only to `.html` and `.htm`; other preview and system-open behavior remains unchanged.
  - Renderer-derived local HTML URLs preserve existing attachment and Workspace target constraints and are never used for external HTTP(S) opening.
  - ClawX-rendered HTTP(S) content links have no anchor semantics, link styling, click handler, or context menu; a typed Host API operation remains available for guest policy and accepts only normalized HTTP(S) destinations before calling `shell.openExternal`.
  - Guest user navigation and popup handling send HTTP(S) destinations externally, keep allowed file navigation internal, deny every child window, and preserve explicit address and context-menu internal navigation.
  - Guest link context menus expose exactly the localized internal and external actions without giving guest content a preload, Node integration, or ClawX bridge.
  - A non-HTML Preview omits the Web Browser tab without clearing or destroying the hidden guest.
  - English, Chinese, Japanese, and Russian strings, focused unit and Electron E2E coverage, communication regression checks, Harness validation, and synchronized documentation pass.
docs:
  required: true
---

## Related Contracts

This task extends `gateway-backend-communication` and the single-guest design in `harness/specs/tasks/web-browser.md`. Durable navigation, popup, context-menu, local-file, localization, and lifecycle behavior remains governed by `harness/reference/web-browser.md` and `harness/specs/rules/web-browser-security-and-lifecycle.md`.
