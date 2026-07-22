# Web Browser

Status: implemented contract, reviewed 2026-07-21.

Related scenarios: `gateway-backend-communication`, `chat-workspace-and-navigation`

Related rule: `web-browser-security-and-lifecycle`

Related task: `web-browser`

## Identity And Navigation

The Web Browser is the artifact tab value `web-browser`. It is distinct from the existing Workspace file browser, whose tab value remains `browser`.

The browser uses exactly partition `persist:clawx-web-browser`, starts each application run at the internal URL `about:blank`, and uses this exact UserAgent on every platform:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36
```

User and page top-level navigation allows normalized `http:`, `https:`, and explicit standard `file:///` URLs. User-entered `about:blank`, hostful file URLs, plain filesystem paths, `chrome:`, `javascript:`, `data:`, and every custom or other protocol are rejected. Renderer address and recovery navigation goes through the typed Host API; Main validates before loading the registered guest. Page navigation, redirects, popup targets, and external opening use the same Main-owned protocol policy. Normal subresources are not filtered by this top-level policy.

## Guest Security And Lifecycle

Main accepts one pending attachment and one single registered guest at a time. The complete attachment identity is the exact partition, initial `about:blank` source, fixed UserAgent, enabled popup delivery, and no preload. Main rejects every additional or mismatched attachment and hardens the accepted guest with no preload, no Node integration, context isolation, sandboxing, and web security enabled. The guest never receives the ClawX preload or host bridge.

After first selection, the global host keeps the same guest mounted while the panel closes, another artifact tab is selected, the chat session changes, or the route changes. Hidden content remains active and may consume resources or play audio. Only destruction of the registered guest releases the slot; crash recovery may then create one replacement and navigate it to the last allowed URL without restoring history.

## Toolbar Presentation

The non-editing address control shows the page title, falling back to the URL, and displays the first URL from the webview's `page-favicon-updated` event when available. Same-origin and same-document navigation retain the current favicon until Electron reports a replacement; cross-origin main-frame navigation clears it. While no favicon is available, including during loading, a same-size globe placeholder reserves the icon slot so the title does not shift. Neither favicon nor placeholder is shown in address-editing mode. Long title or URL text remains truncated, the full URL remains available to assistive technology and edit mode, and hovering the control does not open a URL tooltip. Each of the four More menu actions has a Lucide icon.

## Popup Policy

Every popup handler returns `deny`; no child BrowserWindow, BrowserView, WebContentsView, or second webview is created. Allowed targets navigate the existing guest, while unsupported protocols are rejected. Same-tab fallback cannot preserve `window.opener`, returned window handles, an initially empty popup populated later, `_blank` POST bodies, referrer fidelity, named-window behavior, or window features.

## Permission Policy

Permission check and request handlers are installed on the dedicated session before use. Media prompts are native, localized, scoped to the registered guest and current request, and never remembered.

| Permission | Check path | Request path | Persistence |
| --- | --- | --- | --- |
| Clipboard read, sanitized write, and deprecated compatible read | Allow | Allow without a dialog | Not recorded by ClawX |
| Camera and microphone (`media`) | Return false so a request is made | One native origin-aware Allow/Deny dialog per request | Never remembered |
| Geolocation | Deny | Deny without a dialog | Never remembered |
| Display capture | Deny; no display-media handler | Deny | Never remembered |
| Notifications and every other permission | Deny | Deny without a dialog | Never remembered |

If the requesting guest is destroyed or replaced while a media dialog is open, the request is denied. A combined camera and microphone request uses one decision for both capabilities.

## Data Clearing

Both operations cover every origin in `persist:clawx-web-browser` and complete before Renderer refreshes the current page.

| Action | Clears | Preserves |
| --- | --- | --- |
| Clear Cookies | Cookies only | HTTP cache, Cache Storage, Local Storage, IndexedDB, Service Workers, and downloaded files |
| Clear Site Data | HTTP/Chromium cache, Cache Storage, Local Storage, IndexedDB, and Service Workers | Cookies and downloaded files |

## Downloads And Proxy

Electron default download behavior and the operating system's native flow remain in force. ClawX does not cancel downloads, set a destination, suppress native UI, or add progress, history, or management UI. A platform may present a native Save dialog and wait for user interaction; automatic saving to the system Downloads directory and unattended terminal completion are not guaranteed. If Electron reports completion, Main only logs an interrupted result.

The dedicated session uses Electron/Chromium system proxy resolution. It does not inherit or synchronize the ClawX client proxy, and client proxy changes do not reconfigure the browser partition or close its connections.

## External Opening

Main reads the registered guest's current URL, validates it as `http:`, `https:`, or standard `file:///`, and then calls `shell.openExternal`. Renderer does not provide an arbitrary destination. `about:blank` is disabled. A file URL remains a URL and is never passed to `shell.openPath`; the operating system may open its associated application.

## Final Implementation Anchors

Shared policy is defined by `WEB_BROWSER_PARTITION`, `WEB_BROWSER_INITIAL_URL`, `WEB_BROWSER_USER_AGENT`, `parseWebBrowserAddress`, `normalizeWebBrowserTopLevelUrl`, and `canOpenWebBrowserExternally` in `shared/web-browser.ts`. The typed privileged surface is `hostApi.webBrowser.navigate`, `clearCookies`, `clearSiteData`, and no-argument `openExternal`.

Main ownership is anchored by `WebBrowserGuestRegistry`, `isExpectedWebBrowserAttachment`, `hardenWebBrowserPreferences`, and `installWebBrowserGuestPolicy` in `electron/main/web-browser-policy.ts`; `configureWebBrowserSession` in `electron/main/web-browser-session.ts`; and `createWebBrowserApi` in `electron/services/web-browser-api.ts`.

Renderer ownership is anchored by the `ArtifactTab` value `web-browser`, `webBrowserInitialized`, `openWebBrowser`, and `setWebBrowserAnchor` in `src/stores/artifact-panel.ts`, plus `WebBrowserAnchor`, `WebBrowserHost`, `WebBrowserToolbar`, and `WebBrowserAddressControl`. `MainLayout` mounts one `WebBrowserHost` outside routed content.

Stable acceptance selectors are:

- Panel and placement: `artifact-panel-tabs`, `artifact-panel-tab-web-browser`, and `web-browser-anchor`.
- Persistent surface: `web-browser-host` and `web-browser-webview`.
- Navigation: `web-browser-toolbar`, `web-browser-back`, `web-browser-forward`, `web-browser-refresh`, `web-browser-address-input`, `web-browser-address-display`, and `web-browser-favicon`.
- Privileged actions: `web-browser-more`, `web-browser-force-refresh`, `web-browser-clear-cookies`, `web-browser-clear-site-data`, and `web-browser-open-external`.

## Validation Anchors

Contract and locale coverage is anchored by `tests/unit/harness-specs.test.ts` and `tests/unit/i18n-locale-parity.test.ts`. Shared and privileged boundaries are covered by `tests/unit/web-browser-url.test.ts`, `tests/unit/host-api-facade.test.ts`, `tests/unit/web-browser-policy.test.ts`, `tests/unit/web-browser-session.test.ts`, `tests/unit/web-browser-api.test.ts`, and `tests/unit/host-services.test.ts`. Renderer behavior and placement are covered by `tests/unit/artifact-panel-store.test.ts`, `tests/unit/artifact-panel.test.tsx`, `tests/unit/web-browser-controls.test.tsx`, `tests/unit/web-browser-host.test.tsx`, and `tests/unit/main-layout.test.tsx`.

`tests/e2e/web-browser-navigation.spec.ts` anchors lazy creation, tab order, controls, title-state favicon presentation, absence of a hover URL tooltip, allowed and rejected navigation, same-guest popups, fixed UserAgent, explicit file URLs, and external opening. `tests/e2e/web-browser-lifecycle.spec.ts` anchors hidden background lifetime, geometry, crash replacement, cookie persistence, and the absence of URL/history restoration. `tests/e2e/web-browser-policy.spec.ts` anchors guest isolation, cross-origin clearing scopes, per-request media prompts, clipboard and denied permissions, and untouched Electron/OS download behavior, including the native macOS save-sheet path.
