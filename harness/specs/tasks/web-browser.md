---
id: web-browser
title: Add the single-tab Electron Web Browser
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add one persistent, hardened Electron webview to the Chat artifact panel with Main-owned navigation, session, permission, popup, download, and site-data policy.
touchedAreas:
  - harness/reference/web-browser.md
  - harness/specs/rules/web-browser-security-and-lifecycle.md
  - harness/specs/tasks/web-browser.md
  - shared/web-browser.ts
  - shared/host-api/contract.ts
  - shared/i18n/resources.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - electron/main/web-browser-policy.ts
  - electron/main/web-browser-session.ts
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/services/web-browser-api.ts
  - src/lib/host-api.ts
  - src/stores/artifact-panel.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/web-browser/WebBrowserAddressControl.tsx
  - src/components/web-browser/WebBrowserAnchor.tsx
  - src/components/web-browser/WebBrowserHost.tsx
  - src/components/web-browser/WebBrowserToolbar.tsx
  - src/components/ui/dropdown-menu.tsx
  - src/components/layout/MainLayout.tsx
  - src/types/web-browser.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/web-browser-url.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/web-browser-policy.test.ts
  - tests/unit/web-browser-session.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/web-browser-api.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/artifact-panel-store.test.ts
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/web-browser-controls.test.tsx
  - tests/unit/web-browser-host.test.tsx
  - tests/unit/main-layout.test.tsx
  - tests/e2e/fixtures/web-browser.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/web-browser-navigation.spec.ts
  - tests/e2e/web-browser-lifecycle.spec.ts
  - tests/e2e/web-browser-policy.spec.ts
  - harness/reference/chat-workspace-and-navigation.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - The artifact panel shows one localized Web Browser tab after Changes, distinct from the Workspace browser.
  - First selection lazily creates one hardened guest at about:blank; later tab, panel, session, and route changes hide it while scripts, network activity, audio, and resource use may continue.
  - Address, history, refresh, clear-data, crash recovery, popup, and external-open actions reuse the registered guest and allow only HTTP, HTTPS, and explicit standard file URLs at the top level.
  - Address input treats a host followed by a numeric port as a schemeless HTTPS destination, while Main never performs scheme completion.
  - The title state shows a page-provided favicon or same-size placeholder without a hover URL tooltip, address editing hides the icon slot, and every More menu action has an icon.
  - Cookies and site storage persist in persist:clawx-web-browser, while guest creation, URL, page state, and history do not restore after application restart.
  - Allowed popup targets replace the current page without a child window and cannot preserve window.opener, returned handles, initially blank scripted popups, or full POST/referrer/named-window behavior.
  - Camera and microphone prompt for every request without remembered grants, clipboard variants are allowed, and geolocation, display capture, notifications, and every other permission are denied.
  - Clear Cookies removes only cookies for every origin; Clear Site Data removes cache, Cache Storage, Local Storage, IndexedDB, and Service Workers for every origin while preserving cookies and downloaded files.
  - Downloads retain Electron and operating-system defaults, which may show a native Save dialog and wait for user interaction; ClawX adds no custom path or manager.
  - Browser traffic uses system proxy resolution and is neither configured nor reconfigured from ClawX client proxy settings.
  - Opening an allowed file URL externally may launch the operating system's associated application rather than a browser.
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
  - pnpm harness validate --spec harness/specs/tasks/web-browser.md
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm run lint:check
  - pnpm run typecheck
  - pnpm test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run harness:ci
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts tests/e2e/web-browser-lifecycle.spec.ts tests/e2e/web-browser-policy.spec.ts --workers=1
  - pnpm run test:e2e
acceptance:
  - Exactly one lazily created webview uses persist:clawx-web-browser, about:blank, and the fixed cross-platform UserAgent with no guest preload or Node integration.
  - The initialized guest remains mounted and preserves live state and history across panel, artifact-tab, chat-session, and route hiding; restart returns to about:blank without URL, page-state, or history restoration.
  - Main validates typed navigation, page navigation, redirects, popup targets, and external opening for only HTTP, HTTPS, and explicit standard file URLs; local-file exposure is documented.
  - Renderer parsing preserves host-plus-numeric-port input as an HTTPS host destination, while Main-facing normalization requires an explicit allowed scheme.
  - Every popup is denied as a child, an allowed target reuses the current guest, and window.opener, handles, initially blank scripted popups, and full POST/referrer/named-window compatibility are not promised.
  - Media prompts once per request without persistence, clipboard is allowed, and geolocation, display capture, notifications, and all other permissions are denied.
  - Clear Cookies and Clear Site Data operate across every origin with their documented disjoint storage scopes and preserve downloaded files.
  - Downloads are not canceled or assigned a path by ClawX, may wait on native Save UI, and have no custom manager; unattended completion or a system Downloads path is not promised.
  - The dedicated session uses system proxy resolution without ClawX client-proxy synchronization or connection recycling.
  - External opening reads and validates the registered guest URL; file URLs use shell.openExternal and may open an OS-associated application, never shell.openPath.
  - Every browser control and error uses four-locale text, localized accessible names and tooltips where applicable, semantic disabled behavior, project design tokens, and the stable selectors in the durable reference; the title control has no URL tooltip, reserves a fixed-size favicon or placeholder slot only outside address editing, and every More menu action has a Lucide icon.
  - Unit, Electron E2E, communication regression, Harness, type, lint, build, and documentation checks pass.
docs:
  required: true
---

## Related Contracts

The primary runtime bridge remains rooted in `gateway-backend-communication`. Artifact-panel placement, route-stable host ownership, and the distinction between Workspace `browser` and Electron `web-browser` are linked through `chat-workspace-and-navigation` and `harness/reference/chat-workspace-and-navigation.md`.

`harness/reference/web-browser.md`, this task, and `harness/specs/rules/web-browser-security-and-lifecycle.md` are the authoritative durable design, acceptance, and enforcement records. The reference owns implemented decisions, rationale, rejected alternatives, limitations, symbols, selectors, and test anchors; historical design and implementation-plan files are not inputs to this task.
