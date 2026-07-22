# Web Browser Design

Date: 2026-07-20
Status: Approved for implementation planning

## Summary

Add a single-tab Web Browser to the right-side artifact panel. The tab appears
to the right of Changes, uses Electron's `<webview>` tag, and keeps one guest
WebContents alive for the rest of the application run after its first use.

The feature intentionally does not include multiple tabs, bookmarks, persisted
browsing history, password management, or a download manager.

## Goals

- Add an always-present Web Browser tab after Changes in the artifact panel.
- Provide back, forward, refresh, title/address, and overflow controls.
- Preserve the live page, form state, and in-memory navigation history while
  the panel is closed, another artifact tab is active, the chat session changes,
  or the user visits another application route.
- Use a dedicated persistent Electron session for browser cookies and site data.
- Make popup requests navigate the one existing browser tab.
- Leave Electron and operating-system download behavior intact without adding
  download-management UI or assuming that a download can finish unattended.
- Define and enforce guest WebContents navigation, permission, and preload
  policies in the Main process.
- Document the known limitations of using a single Electron webview as a browser.

## Non-goals

- Multiple browser tabs or windows.
- Bookmarks or a browsing-history interface.
- Restoring the last URL or navigation history after an application restart.
- Password storage or autofill management.
- Favicons.
- A download list, progress interface, or custom download destination.
- Remembered website permission grants.
- Geolocation or display-capture support.
- Full compatibility with websites that require a distinct popup window.

## Terminology and Naming

The existing artifact-panel tab value `browser` means the Workspace file
browser. The new feature must not reuse that name.

- Store tab value: `web-browser`
- Component prefix: `WebBrowser`
- Electron session partition: `persist:clawx-web-browser`
- English tab label: `Web Browser`
- Chinese tab label: `浏览器`

Japanese and Russian labels, as well as all other user-facing strings, are
provided through the existing `chat` i18n namespace.

## User Experience

### Artifact-panel tab

The tab order is Workspace, Preview, Changes, Web Browser. Web Browser is a
fixed tab, not a page-title tab, and only one instance is ever shown.

Selecting Web Browser for the first time creates the webview lazily. The initial
document is `about:blank`, and the address field immediately enters edit mode
and receives focus.

After creation, closing the artifact panel, switching artifact tabs, switching
chat sessions, or leaving Chat only hides the browser. It does not remove the
webview from the DOM. Returning to Web Browser reveals the same live guest.

The browser starts at `about:blank` on every application launch. The persistent
session retains cookies and site storage, but the current URL, in-memory history,
and page state are not restored after restart.

### Browser control bar

The control bar is shown below the artifact-panel tab strip. From left to right
it contains:

1. Back.
2. Forward.
3. Refresh.
4. A combined title and address control.
5. A More menu.

Back and Forward reflect `webview.canGoBack()` and
`webview.canGoForward()` and are disabled when unavailable. Refresh calls
`webview.reload()`.

When the combined control is not being edited, it displays the document title.
If the document has no title, it displays the current URL. A page-provided
favicon appears to the left. Same-origin and same-document navigation retain it
until Electron reports a replacement, while cross-origin main-frame navigation
clears it. When no favicon is available, including while loading, a same-size
globe placeholder reserves the icon slot so the title does not move. Hovering
does not display a URL tooltip. Long values are truncated visually while the
full URL remains available to assistive technology and in edit mode.

Clicking the control enters edit mode and selects the current URL. Enter submits
the value. Escape or focus loss cancels editing and restores the current
document title or URL without navigating. The favicon is hidden in edit mode.

### Address parsing

Input is trimmed before parsing.

- An input without a scheme, such as `example.com`, is prefixed with `https://`.
- Absolute `http:` and `https:` URLs are allowed.
- Standard absolute `file:///` URLs are allowed.
- Plain absolute filesystem paths are not recognized or converted.
- `about:blank` is reserved for the internally created initial document.
- `chrome:`, `javascript:`, `data:`, custom protocols, and all other schemes are
  rejected for top-level navigation.

Renderer parsing gives immediate feedback, then address-bar navigation is sent
through the typed Host API. Main validates the normalized URL before loading it
in the registered guest. Main also applies the same scheme restrictions to
page-initiated top-level navigation, redirects, and popup targets. The policy
does not block ordinary subresource schemes used inside an allowed document.

Allowing `file:` means a user can deliberately load locally readable files.
Normal Chromium origin and web-security restrictions remain enabled.

### More menu

The More menu contains four actions:

1. Force refresh calls `webview.reloadIgnoringCache()`.
2. Clear cookies removes all cookies in `persist:clawx-web-browser`, then force
   refreshes the current page.
3. Clear site data removes the partition's HTTP cache, Cache Storage, Local
   Storage, IndexedDB, and Service Worker data, then force refreshes the current
   page. It does not remove cookies or downloaded files.
4. Open in system browser opens the current `http:`, `https:`, or `file:` URL
   through Electron's `shell.openExternal`. It is disabled on `about:blank`.

Each menu action has a matching Lucide icon.

For `file:` URLs, Main validates and passes the normalized absolute URL directly
to `shell.openExternal`; it does not convert the value to a path or call
`shell.openPath`. The operating system may open the file in its associated
application rather than a web browser. This is an accepted limitation of
supporting the same explicit `file:` destination in this action.

Cookie and site-data clearing apply to every origin in the dedicated browser
partition, not only the currently visible origin. While a clear operation is in
progress, its menu action is disabled to prevent duplicate work.

## Architecture

### Stable global host

`WebBrowserHost` is mounted under `MainLayout`, outside routed page content, so
it survives route transitions. It is not created at application startup. The
artifact-panel store records whether Web Browser has been initialized, and the
host creates the webview only after the first selection of the tab.

The Web Browser body inside `ArtifactPanel` renders a layout anchor rather than
the webview itself. When Web Browser is visible, the global host overlays that
anchor. A `ResizeObserver` and viewport/window resize handling keep the host's
position and dimensions synchronized with the anchor during panel resizing and
window layout changes.

When the anchor is absent or Web Browser is inactive, the global host becomes
non-visible and non-interactive but remains attached to the DOM. This preserves
the guest WebContents. Hidden pages are not suspended or muted and may continue
playing audio, running scripts, making network requests, and using memory.

### Renderer responsibilities

The Renderer owns:

- Artifact tab selection and lazy-initialization state.
- Host visibility and anchor geometry.
- The webview element and its navigation controls.
- Document title, favicon URL, URL, loading, failure, and navigation-history button state.
- Address parsing for immediate user feedback.
- User-facing localized errors and operation progress.

The Renderer listens to the webview's load, navigation, title, favicon, and
process-gone events. Main-frame load failures with Electron's aborted-navigation
error are ignored. Other failures retain the current URL and controls and show a
localized error. A guest-process failure replaces the browser surface with a
localized recovery action that recreates the guest. After the replacement attaches at
`about:blank`, Renderer asks the typed Host API to validate and load the last
known allowed URL. The crashed guest's in-memory history cannot be recovered.

### Typed host API

A typed `webBrowser` Host API module provides only the privileged operations the
control bar requires:

- Validate an address-bar or recovery URL and navigate the registered guest.
- Clear all browser-partition cookies.
- Clear the defined browser-partition site data.
- Open an allowed current URL externally.

The Main implementation hardcodes the partition name and allowed protocols.
The Renderer cannot select another Electron session or pass arbitrary data types
to clear. Back, forward, refresh, and force refresh use the webview DOM API;
address-bar and crash-recovery navigation use `hostApi.webBrowser.navigate`.

The security model trusts the ClawX host Renderer while treating guest pages as
untrusted. Electron does not emit cancellable navigation events when a host
Renderer directly invokes the webview's `loadURL()` method, and any Renderer
with DOM access could invoke that API. Application code must therefore use the
typed navigation action and must not call `webview.loadURL()` directly. This is
policy centralization for trusted application code, not a security boundary
against a fully compromised host Renderer.

### Main-process guest policy

The main BrowserWindow already enables `webviewTag`. Main adds explicit
attachment policy for the Web Browser guest.

On `will-attach-webview`, Main verifies the expected Web Browser identity, the
exact partition, and the initial `about:blank` URL. It rejects unrecognized
webview attachments and forces these preferences:

- No guest preload.
- `nodeIntegration: false`.
- `contextIsolation: true`.
- `sandbox: true`.
- `webSecurity: true`.

The guest never receives the ClawX preload, Node.js access, or the ClawX host
bridge.

The expected identity is the complete combination of:

- Partition `persist:clawx-web-browser`.
- Initial source `about:blank`.
- The exact fixed UserAgent.
- Popup requests enabled so Main can apply the one-tab handler.
- No preload URL.

These are all parameters available to Main during `will-attach-webview`; the
policy does not depend on the webview element's DOM attributes that Electron
does not expose to that event. Main accepts only one attached guest with that
combination at a time. The single registered WebContents ID is the lifecycle
authority after attachment. Main removes that registration only when the
accepted guest is destroyed. Crash recovery may then attach one replacement
with the same identity. Concurrent or additional attachments are rejected.

On `did-attach-webview`, Main registers the guest WebContents ID and installs:

- The fixed UserAgent.
- The one-tab window-open policy.
- Authoritative top-level navigation and redirect scheme checks.
- Guest lifecycle cleanup.

The webview uses `allowpopups` so popup attempts reach
`setWindowOpenHandler`. The handler still denies every child WebContents.

### Fixed UserAgent

The dedicated session and attached guest use this exact value on every
supported operating system:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36
```

Setting it at both the dedicated-session and guest level prevents the initial
navigation or later guest changes from falling back to Electron's default UA.
The UA intentionally reports macOS even when ClawX runs on Windows or Linux.

### Proxy behavior

The dedicated browser session does not inherit or synchronize ClawX's
application-level proxy setting, which currently applies to `defaultSession`.
It uses Electron/Chromium's normal system proxy resolution. Changing the ClawX
client proxy must not reconfigure or close connections in
`persist:clawx-web-browser`.

## Single-tab Window-open Policy

Electron can preserve `window.opener` only by creating a distinct child
WebContents. A `<webview>` element cannot adopt that child, and one browsing
context cannot be both the opener and its child. Preserving `window.opener` is
therefore incompatible with mandatory same-tab navigation.

For every `window.open`, `target="_blank"`, or equivalent request:

- Main returns `{ action: 'deny' }`.
- An allowed `http:`, `https:`, or `file:` target is manually loaded in the
  existing guest.
- Any other target scheme is rejected.
- No BrowserWindow, BrowserView, WebContentsView, or second webview is created.

This fallback has unavoidable compatibility limits:

- `window.opener` is unavailable.
- Scripts that retain and manipulate a returned window handle fail.
- Pages that open `about:blank` and populate it afterward fail.
- Some `_blank` POST bodies, referrers, named-window behavior, and window
  features cannot be reproduced when loading the target in the existing guest.

These limitations must be present in user-facing documentation and in a concise
comment beside the Main-process handler.

## Permission Policy

Permission handlers are installed on `persist:clawx-web-browser` before the
guest is used. They cover both Electron's permission check and request paths.

The synchronous permission-check handler returns `true` only for the allowed
clipboard permission variants. It returns `false` for `media` so Chromium
continues to the asynchronous permission-request path rather than silently
granting camera or microphone access. It also returns `false` for geolocation
and every other permission.

The asynchronous permission-request handler shows the native dialog only for a
`media` request from the registered Web Browser guest. It returns the user's
choice through Electron's request callback. Clipboard variants are granted
without a dialog, and geolocation and every other permission are denied without
a dialog.

### Camera and microphone

An Electron `media` request for video, audio, or both opens a native
`dialog.showMessageBox` attached to the main window. The dialog displays the
requesting security origin and the requested capabilities. If one request asks
for both camera and microphone, one dialog grants or denies both together.

The decision applies only to that request. It is not written to application
state, Electron Store, or the persistent session. A later request prompts again.
If the requesting guest is destroyed while the dialog is open, the request is
denied.

Dialog title, message, capability names, and button labels use the current app
locale with full English, Chinese, Japanese, and Russian coverage.

### Clipboard

Electron clipboard-read, clipboard-sanitized-write, and compatible deprecated
clipboard-read permission variants are allowed by default for this dedicated
browser session. This applies in both permission-check and permission-request
handlers.

### Denied permissions

Geolocation is always denied because ClawX does not provide a location service.
A code comment at the decision records this product limitation.

All other permissions are denied, including notifications, fullscreen, MIDI,
USB, HID, serial, file-system permissions, idle detection, pointer lock, and
storage-access requests. Loading a user-entered `file:///` URL does not grant a
website File System API permission.

Display-media capture is out of scope and no display-media request handler is
installed.

## Downloads

Main installs a `will-download` listener on the dedicated session before the
browser is used. The listener does not call `preventDefault()` and does not set a
save path, so Electron and the operating system retain their default behavior.
Depending on platform and Electron behavior, that flow may save using an OS
default or present a native Save dialog that requires user interaction. ClawX
does not promise automatic saving to the system Downloads directory or terminal
completion without that interaction.

If Electron reports completion, the listener only logs interrupted downloads.
No renderer queue, progress UI, completion list, custom destination picker, or
download history is added; an OS-provided Save dialog is not replaced or
suppressed.

## Data Clearing

Clear cookies uses Electron's session data API with only the `cookies` data type
against `persist:clawx-web-browser`.

Clear site data uses Electron's session data APIs for:

- HTTP and Chromium cache data.
- Cache Storage.
- Local Storage.
- IndexedDB.
- Service Workers.

It explicitly excludes cookies and downloaded files. Both operations apply to
all origins in the partition and resolve only after Electron reports completion.
On success, Renderer force-refreshes the current page. On failure, it leaves the
page unchanged and shows a localized error.

## Error Handling

- Invalid or rejected address input does not navigate and shows a localized
  error while retaining edit mode.
- Main validates every application address/recovery navigation and rejects
  disallowed page-initiated navigation, redirects, and popup targets.
- Non-aborted main-frame load failures show a localized error; Refresh retries.
- Cookie clearing, site-data clearing, and external-open failures show localized
  errors and preserve the current page.
- A crashed guest can be recreated at the last known allowed URL, but its
  in-memory navigation history and page state are lost.
- Download failures are logged without adding browser UI.

## Accessibility and Styling

- Every icon-only control has a localized accessible name and tooltip.
- Disabled navigation buttons expose native disabled semantics.
- The combined title/address control is keyboard accessible and clearly shows
  focus and edit states.
- The More menu follows the project's existing menu and focus-management
  conventions.
- New UI uses the design tokens and component substitutions documented in
  `src/styles/globals.css`.
- The browser host remains non-interactive and absent from the accessibility
  tree while hidden.

## Testing Strategy

### Unit tests

- Artifact-panel store supports the distinct `web-browser` tab and one-time
  lazy initialization.
- Address parsing covers scheme completion, supported URLs, standard
  `file:///` URLs, rejected plain paths, and rejected privileged schemes.
- Combined title/address behavior covers title fallback, favicon presentation,
  absence of a hover URL tooltip, Enter, Escape, blur, and invalid input.
- Main policy helpers cover attachment validation, top-level protocol decisions,
  popup decisions, fixed partition selection, and permission decisions.

### Electron E2E tests

Tests use deterministic local HTTP pages and isolated Electron user data.

- The Web Browser tab appears once and immediately after Changes.
- No guest exists before first selection; exactly one exists afterward.
- URL navigation, title and favicon display, absence of a hover URL tooltip,
  back, forward, refresh, and force refresh operate on the same guest.
- Popup links navigate the current guest and do not create another BrowserWindow
  or guest.
- Closing/reopening the artifact panel, switching artifact tabs, switching chat
  sessions, and visiting another route preserve live page state and history.
- Panel-width dragging and window resizing keep the global host aligned with its
  artifact-panel anchor.
- Requests carry the exact fixed UserAgent.
- Standard `file:///` navigation succeeds while plain paths and disallowed
  schemes are rejected.
- Cookie clearing removes all partition cookies and refreshes the page.
- Site-data clearing removes cache, Local Storage, IndexedDB, Cache Storage, and
  Service Worker state without removing cookies.
- Native camera/microphone decisions are exercised by stubbing the native dialog;
  decisions are not remembered.
- Clipboard permission is allowed, geolocation is denied, and other permissions
  are denied.
- A test download reaches `will-download` and is neither canceled nor assigned a
  path by ClawX. The test accepts a native Save dialog awaiting user interaction;
  when the OS default flow proceeds unattended, it also verifies exact completion.
- Open in system browser passes only an allowed current URL to Electron.
- `file:` external opening calls `shell.openExternal` with the normalized URL
  and never calls `shell.openPath`.
- Guest-process failure presents recovery and recreates one guest.

## Documentation and Harness Work

Implementation must review and update:

- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`
- `README.ru-RU.md`
- `harness/reference/chat-workspace-and-navigation.md`
- `harness/specs/scenarios/chat-workspace-and-navigation.md`

A dedicated durable Web Browser reference documents the session, security,
permission, popup, download, and lifecycle policies. The implementation task
spec references the renderer/Main communication scenario and applicable i18n,
design-token, documentation-sync, and boundary rules.

The implementation must add concise comments at the non-obvious policy points:

- Why the global webview host remains mounted while hidden.
- Why popup requests are denied and manually loaded in the current guest.
- Why geolocation is unconditionally denied.
- Why `will-download` deliberately leaves Electron's default behavior intact.
- Why the UserAgent is fixed to a macOS value on every platform.

## Acceptance Criteria

- The artifact panel contains one localized Web Browser tab after Changes.
- The webview is created lazily and survives all in-app hiding and route changes.
- The dedicated persistent session and exact UserAgent are used.
- Navigation and all control-bar actions behave as specified.
- Only `http:`, `https:`, and standard `file:///` top-level destinations are
  accepted, apart from the internal initial `about:blank` document.
- Popup requests always reuse the current guest without creating a child.
- Camera and microphone prompt once per request, clipboard is allowed,
  geolocation and all other permissions are denied.
- Downloads remain under Electron/OS default behavior, which may require a native
  Save-dialog choice, without custom paths or download-management UI.
- Cookie and site-data actions clear exactly their documented data sets.
- All new user-facing strings have English, Chinese, Japanese, and Russian
  translations.
- Electron E2E coverage verifies the user-visible interaction and Main-process
  policies.
- README, harness, durable reference documentation, and required code comments
  describe the feature and its limitations.
