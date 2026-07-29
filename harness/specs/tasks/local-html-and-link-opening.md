---
id: local-html-and-link-opening
title: Reduce embedded browsing to local HTML preview
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preview authorized local HTML in ClawX or open the file externally, while removing general web browsing and making every rendered link inert.
touchedAreas:
  - harness/specs/tasks/local-html-and-link-opening.md
  - harness/specs/tasks/web-browser.md
  - harness/specs/rules/web-browser-security-and-lifecycle.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/specs/rules/tool-derived-file-safety.md
  - harness/reference/web-browser.md
  - harness/reference/chat-workspace-and-navigation.md
  - harness/reference/acp-attachment-access-control.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/acp-file-activity.md
  - harness/specs/tasks/unify-acp-file-cards.md
  - harness/reference/office-document-preview.md
  - harness/specs/rules/office-preview-safety.md
  - harness/specs/tasks/office-document-preview.md
  - package.json
  - pnpm-lock.yaml
  - shared/web-browser.ts
  - shared/host-api/contract.ts
  - shared/i18n/resources.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - electron/main/index.ts
  - electron/main/web-browser-policy.ts
  - electron/main/web-browser-session.ts
  - electron/services/web-browser-api.ts
  - src/lib/host-api.ts
  - src/lib/local-html-browser.ts
  - src/stores/artifact-panel.ts
  - src/components/common/BrowserLink.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/HtmlPreview.tsx
  - src/components/file-preview/MarkdownPreview.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/web-browser/WebBrowserAddressControl.tsx
  - src/components/web-browser/WebBrowserAnchor.tsx
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
  - tests/unit/artifact-panel-store.test.ts
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/browser-link.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/html-preview.test.tsx
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/web-browser-api.test.ts
  - tests/unit/web-browser-controls.test.tsx
  - tests/unit/web-browser-host.test.tsx
  - tests/unit/web-browser-policy.test.ts
  - tests/unit/web-browser-session.test.ts
  - tests/unit/web-browser-url.test.ts
  - tests/unit/workspace-browser-body.test.tsx
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/web-browser-lifecycle.spec.ts
  - tests/e2e/web-browser-navigation.spec.ts
  - tests/e2e/web-browser-policy.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Activating an authorized local `.html` or `.htm` attachment, file activity, or Workspace file opens the existing Preview tab; no standalone Web Browser tab, Home page, or address bar exists.
  - HTML file actions let the user choose the ClawX preview or the system browser. Other file formats retain their existing preview and system-open behavior.
  - Links rendered by ClawX and links or areas rendered inside HTML preview have ordinary text styling and cannot be clicked.
  - HTML guest navigation, redirects, forms, script navigation, in-page navigation, popups, downloads, network requests, and permissions are blocked.
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
  - pnpm exec vitest run tests/unit/browser-link.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/web-browser-host.test.tsx tests/unit/web-browser-url.test.ts tests/unit/web-browser-api.test.ts tests/unit/web-browser-policy.test.ts tests/unit/web-browser-session.test.ts tests/unit/host-api-facade.test.ts tests/unit/i18n-locale-parity.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-file-changes.spec.ts --workers=1
acceptance:
  - Renderer derives internal destinations only from validated attachment or Workspace refs and `.html`/`.htm` extensions.
  - Main accepts only hostless, query-free, fragment-free `file:///` HTML URLs for application-triggered loads and external opening.
  - Exactly one guest uses the dedicated partition with no preload, Node integration, popup capability, browser chrome, or general HTTP navigation API.
  - Main blocks all guest-initiated navigation and injects user-origin CSS that removes anchor/area styling and pointer interaction.
  - The dedicated Session denies permissions, cancels downloads and network requests, and rejects non-HTML main documents.
  - English, Chinese, Japanese, and Russian strings, tests, Harness validation, communication regression checks, and synchronized documentation pass.
docs:
  required: true
---

# Local HTML preview implementation task

This spec replaces the former general-purpose embedded browser contract. The retained webview is an implementation detail of the local HTML Preview tab, not a user-addressable browser.
