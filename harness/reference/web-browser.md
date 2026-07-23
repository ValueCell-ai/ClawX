# Web Browser

Status: implemented contract, reviewed 2026-07-23.

Related scenarios: `gateway-backend-communication`, `chat-workspace-and-navigation`

Related rule: `web-browser-security-and-lifecycle`

Related task: `web-browser`

This reference is authoritative for the implemented Web Browser design. The task and rule named above are the executable Harness entry points; historical design and implementation-plan documents are not dependencies.

## Scope And Non-Goals

The Web Browser is the fixed fourth artifact-panel tab with store value `web-browser`. It is distinct from the Workspace file browser, whose value remains `browser`. The tab provides one embedded browsing context with back, forward, refresh, title/address, favicon, force refresh, data clearing, and external-open controls.

The feature does not provide multiple tabs or windows, bookmarks, a browsing-history interface, URL or history restoration after restart, password or autofill management, remembered permission grants, geolocation, display capture, a download manager, a custom download destination, or full compatibility with sites that require a distinct popup browsing context. Favicons are implemented and are not a non-goal. A hover URL tooltip is intentionally absent. User-facing labels and errors are owned by the current `chat` locale resources in `shared/i18n/locales/{en,zh,ja,ru}/chat.json`; old design-document label examples are not authoritative.

## Trust Model And Ownership

The ClawX host Renderer is trusted application code; every page loaded in the guest is untrusted. Main owns the dedicated session, accepted attachment identity, single registered guest, top-level URL policy, popup policy, permissions, data clearing, and external opening. Renderer owns lazy selection state, the route-stable host and anchor geometry, webview event-derived toolbar state, immediate address feedback, and localized presentation.

Application address and recovery navigation must use `hostApi.webBrowser.navigate`. Main normalizes and validates the URL, obtains the registered guest from `WebBrowserGuestRegistry`, and calls `guest.loadURL()`. Renderer history, normal refresh, and force refresh use the attached webview DOM methods because they act on its existing navigation controller; Renderer application code must not call `webview.loadURL()`.

This division centralizes trusted application behavior but is not a security boundary against a compromised host Renderer. Electron does not expose a cancellable Main event for every direct host-Renderer `webview.loadURL()` call, and host DOM access could invoke it. Main policy instead protects the host from untrusted guest content, rejects unauthorized attachment identities and top-level page transitions it can observe, and prevents the guest from receiving ClawX privileges.

## Identity And Session

The browser uses exactly partition `persist:clawx-web-browser`, creates its guest at the internal URL `about:blank`, and uses this exact UserAgent at both Session and guest level on every platform:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36
```

The persistent partition retains cookies and site storage. Only artifact-panel width is persisted by the relevant UI store, so guest creation, current URL, live page state, and in-memory navigation history restart at an uncreated guest and then `about:blank` on every application run.

## Address Parsing And Top-Level Policy

`parseWebBrowserAddress` implements address-bar parsing in this order:

1. Trim surrounding whitespace and reject an empty value.
2. Reject Unix-rooted, slash- or backslash-rooted, Windows drive-rooted, UNC-like, and tilde-rooted filesystem paths. ClawX never converts a plain path into a URL.
3. Detect an explicit URI scheme with `^[a-z][a-z\d+.-]*:`. A host token followed by a numeric port is the deliberate exception: inputs such as `localhost:3000`, `127.0.0.1:8080/status`, and `example.com:8443/path` are treated as a schemeless host plus numeric port, not as a custom scheme, and receive `https://`.
4. Prefix every other schemeless value with `https://`, parse with the platform `URL` implementation, and return its canonical `href`.
5. Accept only absolute `http:`, `https:`, and explicit standard `file:///` URLs. The file spelling must begin with `file:///`; hostful file URLs and abbreviated `file:` forms are rejected. Accepted file URLs must parse with an empty hostname.
6. Reject the reserved `about:blank` URL, malformed URLs, `chrome:`, `javascript:`, `data:`, `ftp:`, and every other protocol.

`normalizeWebBrowserTopLevelUrl` is the stricter Main-facing policy. It trims and canonicalizes but never completes a missing scheme, never converts a path, and accepts the same `http:`, `https:`, and `file:///` set while rejecting `about:blank`. The initial `about:blank` is allowed only as part of the verified attachment identity before guest navigation policy is installed.

Main applies that strict policy to typed navigation, crash recovery, main-frame `will-navigate`, main-frame `will-redirect`, popup targets, and the registered guest's current URL before external opening. Subframe redirects and ordinary document subresources are not filtered by this top-level policy. Explicit `file:///` support deliberately permits a user to load locally readable files, subject to Chromium origin isolation and enabled web security.

## One-Guest Host Geometry, Visibility, And Focus

`MainLayout` mounts one `WebBrowserHost` outside routed page content. It returns no webview until `webBrowserInitialized` becomes true on first tab selection. `ArtifactPanel` renders `WebBrowserAnchor`; the host is a fixed-position overlay whose fractional `left`, `top`, `width`, and `height` mirror the connected, positive-size anchor.

Geometry is measured immediately and refreshed through `ResizeObserver`, window resize, capturing scroll, and `visualViewport` resize. Signals are coalesced to one `requestAnimationFrame`. A missing, disconnected, zero-width, or zero-height anchor makes the host unavailable rather than leaving stale interactive geometry.

After initialization the same webview DOM node and guest remain mounted across panel close, artifact-tab changes, chat-session changes, and route changes. A visible host requires an open panel, active `web-browser` tab, and valid geometry. Otherwise it uses hidden visibility, no pointer events, `aria-hidden=true`, and `inert`; it is not suspended, muted, reloaded, or destroyed, so scripts, network traffic, audio, and resource use may continue. If focus is inside when the host becomes hidden, focus moves to the Web Browser tab or the first available application focus target. A crash also moves focus out before presenting recovery UI. The More menu closes when the browser becomes hidden or crashed.

## Toolbar, Editing, And Async Races

Back and Forward reflect `canGoBack()` and `canGoForward()` and use native disabled semantics. Refresh calls `reload()` and Force Refresh calls `reloadIgnoringCache()` only on the currently attached guest.

The non-editing address control displays the title, falling back to the URL. It displays the first `page-favicon-updated` URL, with a same-size globe placeholder if no candidate loads. Same-document and same-origin main-frame navigation retain the current favicon; cross-origin navigation and redirects clear it until a replacement arrives. Editing hides both favicon and placeholder. Visual text truncates, while the full URL remains available to assistive technology and edit mode; hovering does not show a URL tooltip.

The initial blank document starts with an empty, focused, selected draft. Clicking the display snapshots the current URL into the draft. Page title or URL changes never overwrite an active draft. Escape and blur cancel without navigation and reveal the latest page title/URL. Invalid Enter input retains and refocuses the draft. Valid Enter input stays in edit mode until the Host API navigation resolves; only the latest submission may close or refocus the editor, so an older promise cannot overwrite a newer attempt.

Renderer assigns a generation to each Host API navigation and reports at most one localized load failure for the active request even if both `did-fail-load` and the Host API promise reject. Main and Renderer treat Electron `ERR_ABORTED` (`-3`) as a normal superseded/cancelled load. A later genuine failure is not suppressed by completion of an older request.

Each clear operation disables only its matching menu action. On success Renderer force-refreshes only if the captured webview is still the current generation and is attached; a guest that attaches during the operation may refresh, but a crashed or replacement guest must not. Clear failure leaves the page unchanged.

## Main Startup And Attachment Ordering

One `WebBrowserGuestRegistry` is created at module scope. During `initialize()`, Main configures the dedicated Session before proxy/network side effects and before constructing the main BrowserWindow. Session UserAgent, permission handlers, and the single default-download observer therefore exist before any guest can use the partition.

Immediately after BrowserWindow construction, before loading Renderer content, `installWebBrowserGuestPolicy` installs `will-attach-webview` and `did-attach-webview` listeners on the embedder. Typed Host API services are then registered before `loadMainWindow()`. This order is required: no Renderer-created webview may attach before the session policy, attachment gate, or privileged navigation service exists.

`will-attach-webview` synchronously accepts only the complete identity: exact partition, initial `about:blank` source, fixed UserAgent, boolean popup delivery enabled, and an empty preload value. It reserves the sole pending slot before hardening preferences. Mismatches, concurrent reservations, and additional live guests are prevented.

Hardening deletes preload and forces Node integration off in the main frame, subframes, and workers; plugins and insecure-content execution off; context isolation, sandboxing, and web security on. On `did-attach-webview`, Main additionally verifies webview type and exact Session, completes registry ownership, reapplies the fixed UserAgent, and installs top-level navigation, redirect, popup, cleanup, and destruction handling. The guest receives neither the ClawX preload nor `window.clawx`, `window.electron`, Node globals, or the host bridge. Ownership is released only when the registered guest is destroyed; only then may recovery reserve a replacement.

## Popup Policy And Rationale

Every `setWindowOpenHandler` result is `deny`, so no child BrowserWindow, BrowserView, WebContentsView, or second webview is created. If the target passes strict top-level normalization and the handler still owns the guest, Main manually loads it in that guest; unsupported targets and load failures are logged.

A distinct child browsing context is required to preserve `window.opener`, but the one-tab product cannot make one guest simultaneously be opener and child or adopt a child into the existing webview. Same-tab fallback is therefore intentional and cannot preserve returned window handles, initially blank popups populated later, `_blank` POST bodies, full referrer fidelity, named-window behavior, or window features.

## Permission Policy

Permission check and request handlers are installed on the dedicated Session before Renderer loading. Decisions are scoped to the current registered guest and are never persisted by ClawX.

| Permission | Check path | Request path | Persistence |
| --- | --- | --- | --- |
| Clipboard read, sanitized write, and deprecated compatible read | Allow | Allow without a dialog | Not recorded by ClawX |
| Camera and microphone (`media`) | Return false so a request is made | One native origin-aware Allow/Deny dialog per request from the registered guest | Never remembered |
| Geolocation | Deny | Deny without a dialog | Never remembered |
| Display capture | Deny; no display-media handler | Deny | Never remembered |
| Notifications and every other permission | Deny | Deny without a dialog | Never remembered |

A media request must contain audio, video, or both and must belong to the registered guest. One localized native dialog covers a combined camera/microphone request. Missing main window, empty or screen-only media types, dialog/language errors, and guest destruction or replacement before the answer all deny exactly once. Locale text is resolved at request time.

## Data Clearing, Downloads, Proxy, And External Opening

Both clear operations cover every origin in `persist:clawx-web-browser` and complete before Renderer conditionally refreshes the captured guest.

| Action | Clears | Preserves |
| --- | --- | --- |
| Clear Cookies | Cookies only | HTTP cache, Cache Storage, Local Storage, IndexedDB, Service Workers, and downloaded files |
| Clear Site Data | HTTP/Chromium cache, Cache Storage, Local Storage, IndexedDB, and Service Workers | Cookies and downloaded files |

Electron default download behavior and the operating system's native flow remain in force. The single Session listener observes completion only to log interruption; it does not cancel, set a path, suppress native UI, or create progress/history UI. A platform may show a native Save dialog and wait for user interaction. Automatic saving to Downloads and unattended terminal completion are not promised.

The dedicated Session uses Electron/Chromium system proxy resolution. It does not inherit or synchronize ClawX client proxy settings, call `setProxy`, recycle browser connections after client-proxy changes, or alter `defaultSession` behavior.

External opening takes no Renderer URL argument. Main reads the registered guest's current URL, strictly validates and normalizes it, then calls `shell.openExternal`. `about:blank` is disabled. An allowed file URL remains a URL and is never passed to `shell.openPath`; the operating system may open its associated application rather than a browser.

## Failure Semantics And Crash Recovery

Parser errors keep the current page and active draft and show the error mapped from the exact parser result. Non-aborted main-frame load failures show one localized load error while retaining the current URL and controls. Policy-blocked page transitions and popup failures are logged by Main. Data-clear and external-open failures show localized errors and do not replace the page. Download interruption is log-only.

`render-process-gone` clears active attachment/loading/navigation state and favicon state, removes the failed webview from the rendered surface, and presents localized recovery UI. Recovery is explicit. It creates one replacement with the original attachment identity at `about:blank`; only after `did-attach` does Renderer ask the typed Host API to load the last observed URL that still passes strict top-level policy. If no such URL exists, the replacement remains blank. Recovery does not restore the crashed guest's history, page state, form state, returned popup handles, or favicon. Back and Forward reset disabled.

## Required Policy-Rationale Comments

The following non-obvious decisions must retain concise adjacent source comments. The reference carries the full rationale; comments should explain the local invariant rather than duplicate this document.

- `WebBrowserHost`: removing a hidden webview destroys its guest, so inactive states hide the route-stable host instead.
- `installWebBrowserGuestPolicy`: popup children are denied and allowed targets use lossy same-tab fallback, including its opener/handle/fidelity limitation.
- `configureWebBrowserSession`: geolocation is denied because ClawX provides no location service.
- `configureWebBrowserSession`: the download observer deliberately preserves Electron/OS default save behavior by neither cancelling nor assigning a path.
- `configureWebBrowserSession`: the macOS-shaped UserAgent is intentionally fixed on every platform for stable compatibility and deterministic requests.

## Rejected Alternatives

- Multiple webviews, child windows, BrowserViews, and WebContentsViews were rejected because the product contract is one persistent tab with one registry authority.
- Mounting the webview inside routed artifact content or unmounting it while hidden was rejected because either destroys the guest and loses live state/history.
- Restoring URL/history or persisting guest initialization was rejected; only partition storage and artifact-panel width survive restart.
- Direct Renderer `loadURL()`, Renderer-selected partitions, scheme completion in Main, and arbitrary external-open destinations were rejected in favor of one typed privileged path and strict Main normalization.
- Search-query guessing, plain filesystem-path conversion, hostful file URLs, broader protocols, and `about:blank` user navigation were rejected to keep top-level interpretation explicit.
- Creating popup children for better web compatibility was rejected because it violates one-guest ownership; same-tab compatibility loss is accepted.
- Remembered permissions, geolocation/display capture, custom download paths/management, and ClawX proxy synchronization were rejected scope and security expansions.
- A hover URL tooltip was rejected; the URL is exposed through assistive text and edit mode. Omitting favicons is an obsolete design claim, not an implemented alternative.

## Implementation Anchors

Shared policy is defined by `WEB_BROWSER_PARTITION`, `WEB_BROWSER_INITIAL_URL`, `WEB_BROWSER_USER_AGENT`, `parseWebBrowserAddress`, `normalizeWebBrowserTopLevelUrl`, and `canOpenWebBrowserExternally` in `shared/web-browser.ts`. The typed privileged surface is `hostApi.webBrowser.navigate`, `clearCookies`, `clearSiteData`, and no-argument `openExternal`.

Main ownership is anchored by `WebBrowserGuestRegistry`, `isExpectedWebBrowserAttachment`, `hardenWebBrowserPreferences`, and `installWebBrowserGuestPolicy` in `electron/main/web-browser-policy.ts`; `configureWebBrowserSession` in `electron/main/web-browser-session.ts`; startup sequencing in `electron/main/index.ts`; and `createWebBrowserApi` in `electron/services/web-browser-api.ts`.

Renderer ownership is anchored by the `ArtifactTab` value `web-browser`, `webBrowserInitialized`, `openWebBrowser`, and `setWebBrowserAnchor` in `src/stores/artifact-panel.ts`, plus `WebBrowserAnchor`, `WebBrowserHost`, `WebBrowserToolbar`, and `WebBrowserAddressControl`. `MainLayout` mounts one `WebBrowserHost` outside routed content.

Stable acceptance selectors are:

- Panel and placement: `artifact-panel-tabs`, `artifact-panel-tab-web-browser`, and `web-browser-anchor`.
- Persistent surface: `web-browser-host` and `web-browser-webview`.
- Navigation: `web-browser-toolbar`, `web-browser-back`, `web-browser-forward`, `web-browser-refresh`, `web-browser-address-input`, `web-browser-address-display`, `web-browser-favicon`, and `web-browser-favicon-placeholder`.
- Privileged actions: `web-browser-more`, `web-browser-force-refresh`, `web-browser-clear-cookies`, `web-browser-clear-site-data`, and `web-browser-open-external`.

## Validation Anchors

Contract and locale coverage is anchored by `tests/unit/harness-specs.test.ts` and `tests/unit/i18n-locale-parity.test.ts`. Shared and privileged boundaries are covered by `tests/unit/web-browser-url.test.ts`, `tests/unit/host-api-facade.test.ts`, `tests/unit/web-browser-policy.test.ts`, `tests/unit/web-browser-session.test.ts`, `tests/unit/web-browser-api.test.ts`, and `tests/unit/host-services.test.ts`. Renderer behavior and placement are covered by `tests/unit/artifact-panel-store.test.ts`, `tests/unit/artifact-panel.test.tsx`, `tests/unit/web-browser-controls.test.tsx`, `tests/unit/web-browser-host.test.tsx`, and `tests/unit/main-layout.test.tsx`.

`tests/e2e/web-browser-navigation.spec.ts` anchors lazy creation, tab order, controls, title/favicon presentation, absence of a hover URL tooltip, allowed and rejected navigation, same-guest popups, fixed UserAgent, explicit file URLs, and external opening. `tests/e2e/web-browser-lifecycle.spec.ts` anchors hidden background lifetime, geometry, crash replacement, cookie persistence, and lack of URL/history restoration. `tests/e2e/web-browser-policy.spec.ts` anchors guest isolation, cross-origin clearing scopes, per-request media prompts, clipboard and denied permissions, and untouched Electron/OS download behavior, including the native macOS save-sheet path.

## Validation Limitations

Unit tests use mocked Electron and DOM surfaces, so they validate policy decisions and ordering logic rather than Chromium enforcement. Electron E2E uses deterministic local pages and isolated user data; it does not establish compatibility with every website, authentication flow, popup pattern, service worker, permission type, real camera/microphone device, enterprise proxy, or hostile compromised host Renderer.

Native Save UI, `shell.openExternal` handling of file URLs, system proxy resolution, and permission presentation vary by operating system and environment. E2E can observe that ClawX does not cancel or assign a download path and can cover known native macOS save-sheet behavior, but cannot promise unattended completion or every platform's UI. Hidden-state tests prove retained guest identity and representative live state/history, not an upper bound on background CPU, memory, network, or audio use. Manual platform checks remain appropriate when Electron is upgraded or native behavior changes.
