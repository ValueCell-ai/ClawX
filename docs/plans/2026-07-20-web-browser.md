# Web Browser Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, single-tab Electron Web Browser to the right artifact panel that is created lazily, remains alive across in-app navigation, and exposes the approved navigation, permission, storage, download, and external-open behavior.

**Architecture:** A global `WebBrowserHost` remains mounted under `MainLayout` and overlays an anchor rendered by the Chat artifact panel. Renderer controls use a typed `webBrowser` Host API for address/recovery navigation and privileged session actions, while Main owns one hardened guest WebContents, the dedicated persistent session, popup rewriting, navigation policy, permissions, and downloads.

**Tech Stack:** Electron 40.8.4, React 19, TypeScript, Zustand, Radix Dropdown Menu, react-i18next, Vitest, Testing Library, and Playwright Electron E2E.

## Global Constraints

- Follow the approved design in `docs/specs/2026-07-20-web-browser-design.md`.
- Keep the existing Workspace tab value `browser`; use `web-browser` for the new tab and `WebBrowser*` for feature symbols.
- Use exactly one guest with partition `persist:clawx-web-browser` and initial URL `about:blank`.
- Use this exact UserAgent on every platform:

```text
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36
```

- Accept top-level `http:`, `https:`, and explicit standard `file:///` URLs. Reject plain filesystem paths, user-entered `about:blank`, `chrome:`, `javascript:`, `data:`, and custom protocols.
- Route address-bar and crash-recovery navigation through `hostApi.webBrowser.navigate`. Application code must not call the webview's `loadURL()` directly.
- Back, forward, refresh, and force refresh may use WebView DOM methods because they operate on already accepted history/current content.
- Trust the ClawX host Renderer, but treat all guest content as untrusted. Do not expose the ClawX preload, Node.js, or direct IPC to the guest.
- Return `deny` for every popup and manually load allowed popup targets in the current guest. Do not create BrowserWindow, BrowserView, WebContentsView, or another webview.
- Keep the initialized webview mounted while hidden. Do not mute, suspend, stop, reload, or recreate it during tab, panel, session, or route changes.
- Prompt for camera/microphone once per request through a native localized dialog. Allow clipboard permissions. Deny geolocation and every other permission. Do not remember decisions.
- Leave Electron/OS download defaults intact. Do not cancel downloads, set a path, suppress a native Save dialog, or add download-management UI; platform defaults may require user interaction and need not finish unattended.
- Clear Cookie and Clear Site Data operate on every origin in the dedicated partition and have disjoint documented data sets.
- Do not synchronize the ClawX client proxy to the browser partition. Let Electron/Chromium use normal system proxy resolution.
- Route every new display string through the `chat` namespace with matching `en`, `zh`, `ja`, and `ru` keys.
- Use project design tokens and semantic controls. Add Electron E2E coverage for every user-visible browser interaction.
- Do not add multi-tab support, bookmarks, persisted URL/history, password management, permission memory, geolocation, display capture, or a download manager.

---

### Task 1: Establish the Harness Contract

**Files:**
- Create: `harness/reference/web-browser.md`
- Create: `harness/specs/rules/web-browser-security-and-lifecycle.md`
- Create: `harness/specs/tasks/web-browser.md`
- Modify: `harness/reference/chat-workspace-and-navigation.md`
- Modify: `harness/specs/scenarios/chat-workspace-and-navigation.md`
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify: `harness/specs/rules/ui-i18n-design-tokens.md`
- Test: `tests/unit/harness-specs.test.ts`

**Interfaces:**
- Consumes: The approved design spec and existing Harness scenario/rule schema.
- Produces: Task ID `web-browser`, rule ID `web-browser-security-and-lifecycle`, and the durable policy reference used by every later task.

- [ ] **Step 1: Write the failing Harness contract test**

Add assertions to `tests/unit/harness-specs.test.ts` that require:

- `harness/specs/tasks/web-browser.md` to use `scenario: gateway-backend-communication`, `taskType: runtime-bridge`, profiles `fast`, `comms`, and `e2e`, and `docs.required: true`.
- Required rules `renderer-main-boundary`, `backend-communication-boundary`, `api-client-transport-policy`, `host-api-fallback-policy`, `ui-i18n-design-tokens`, `web-browser-security-and-lifecycle`, `comms-regression`, and `docs-sync`.
- `chat-workspace-and-navigation` to own `src/components/web-browser/**`, the browser E2E specs, and link `harness/reference/web-browser.md`.
- The browser reference to name the exact partition, exact UserAgent, allowed protocols, single-guest lifecycle, permission table, data-clearing boundaries, popup limitations, download behavior, proxy behavior, and validation anchors.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
pnpm exec vitest run tests/unit/harness-specs.test.ts
```

Expected: failure because the Web Browser task, rule, reference, and scenario ownership do not exist.

- [ ] **Step 3: Create the task, rule, and reference**

Use this required task frontmatter:

```yaml
id: web-browser
title: Add the single-tab Electron Web Browser
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add one persistent, hardened Electron webview to the Chat artifact panel with Main-owned navigation, session, permission, popup, download, and site-data policy.
requiredProfiles:
  - fast
  - comms
  - e2e
docs:
  required: true
```

List all shared, Main, Renderer, locale, E2E, Harness, and README paths from this plan under `touchedAreas`. Include concise expected behavior and acceptance entries matching the approved design. The new rule must prohibit extra guests/windows, arbitrary partitions, guest preloads, Node integration, disabled web security, direct Renderer IPC, unvalidated external opening, remembered permissions, custom download handling, and unmounting an initialized guest.

Update the two scenarios and existing navigation reference so Workspace `browser` and Web Browser `web-browser` are explicitly distinct. Add `chat-workspace-and-navigation` to the UI rule's `appliesTo` list and require localized accessible names/tooltips for browser controls.

- [ ] **Step 4: Validate the real task spec and focused tests**

Run without `--no-diff`:

```bash
pnpm harness validate --spec harness/specs/tasks/web-browser.md
pnpm harness run --spec harness/specs/tasks/web-browser.md --dry-run
pnpm exec vitest run tests/unit/harness-specs.test.ts
```

Expected: all commands pass and the dry run selects `fast`, `comms`, and `e2e`.

- [ ] **Step 5: Commit the task**

```bash
git add harness/reference/web-browser.md harness/reference/chat-workspace-and-navigation.md harness/specs/rules/web-browser-security-and-lifecycle.md harness/specs/rules/ui-i18n-design-tokens.md harness/specs/scenarios/chat-workspace-and-navigation.md harness/specs/scenarios/gateway-backend-communication.md harness/specs/tasks/web-browser.md tests/unit/harness-specs.test.ts
git commit -m "test: define web browser harness contract"
```

### Task 2: Add Shared URL Policy and Host API Contract

**Files:**
- Create: `shared/web-browser.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Test: `tests/unit/web-browser-url.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Consumes: Existing `HostApiContract`, `invokeHost`, and shared path aliases.
- Produces: Browser constants, URL parsing/normalization helpers, `WebBrowserNavigatePayload`, and `hostApi.webBrowser` methods used by Main and Renderer.

- [ ] **Step 1: Write failing URL-policy and facade tests**

Create table-driven tests for:

- Exact partition, initial URL, and UserAgent constants.
- Trimming and scheme completion for `example.com`, `localhost:3000`, IPv4 hosts, and host/path/query input.
- Normalization of absolute HTTP and HTTPS URLs.
- Acceptance of `file:///tmp/example.html`, encoded paths, and Windows `file:///C:/...` syntax.
- Rejection of POSIX paths, Windows paths, UNC paths, tilde paths, hostful `file://server/...`, empty input, malformed URLs, user-entered `about:blank`, and unsupported protocols.
- Main-facing normalization that never prefixes a missing protocol.
- External-open eligibility for only HTTP, HTTPS, and standard file URLs.

Extend facade tests to expect these calls:

```ts
hostApi.webBrowser.navigate(url)
hostApi.webBrowser.clearCookies()
hostApi.webBrowser.clearSiteData()
hostApi.webBrowser.openExternal()
```

The facade must use only `host:invoke`; no legacy direct IPC channel is allowed.

- [ ] **Step 2: Run focused tests and verify the expected failures**

```bash
pnpm exec vitest run tests/unit/web-browser-url.test.ts tests/unit/host-api-facade.test.ts
```

Expected: missing shared module, contract module, and facade methods.

- [ ] **Step 3: Implement the shared policy and typed contract**

Export these stable names from `shared/web-browser.ts`:

```ts
export const WEB_BROWSER_PARTITION = 'persist:clawx-web-browser' as const;
export const WEB_BROWSER_INITIAL_URL = 'about:blank' as const;
export const WEB_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36' as const;

export type WebBrowserAddressErrorCode =
  | 'empty'
  | 'absolute-path'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'reserved-url';

export type WebBrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; reason: WebBrowserAddressErrorCode };

export type WebBrowserNavigatePayload = { url: string };

export function parseWebBrowserAddress(input: string): WebBrowserAddressResult;
export function normalizeWebBrowserTopLevelUrl(input: string): string | null;
export function canOpenWebBrowserExternally(input: string): boolean;
```

Write the UA as adjacent string literals if needed, but make the exported runtime value exactly match the design. Detect filesystem paths before attempting scheme completion. Treat host-plus-numeric-port input as a host, not a custom protocol. Require the original local-file input to begin with `file:///` and require an empty URL hostname.

Add this contract module:

```ts
webBrowser: {
  navigate: (payload: WebBrowserNavigatePayload) => void;
  clearCookies: () => void;
  clearSiteData: () => void;
  openExternal: () => void;
};
```

Expose ergonomic facade methods that pass `{ url }` only for `navigate`; Main will read the registered guest URL for external opening.

- [ ] **Step 4: Run focused tests and type checks**

```bash
pnpm exec vitest run tests/unit/web-browser-url.test.ts tests/unit/host-api-facade.test.ts
pnpm run typecheck:web
```

Expected: URL and facade tests pass; the Renderer contract type-checks.

- [ ] **Step 5: Commit the task**

```bash
git add shared/web-browser.ts shared/host-api/contract.ts src/lib/host-api.ts tests/unit/web-browser-url.test.ts tests/unit/host-api-facade.test.ts
git commit -m "feat: add web browser host contract"
```

### Task 3: Implement the Main Guest Registry and Attachment Policy

**Files:**
- Create: `electron/main/web-browser-policy.ts`
- Test: `tests/unit/web-browser-policy.test.ts`

**Interfaces:**
- Consumes: `WEB_BROWSER_PARTITION`, `WEB_BROWSER_INITIAL_URL`, `WEB_BROWSER_USER_AGENT`, and `normalizeWebBrowserTopLevelUrl`.
- Produces: `WebBrowserGuestRegistry`, attachment hardening, popup rewriting, and page-navigation policy for startup and Host API tasks.

- [ ] **Step 1: Write failing policy tests**

Cover:

- Exact attachment parameter checks for partition, source, UA, `allowpopups`, and empty preload.
- Rejection when any identity parameter differs.
- Runtime boolean handling for `allowpopups` despite Electron's broad parameter typing.
- Forced removal of preload and forced guest preferences.
- One pending attachment reservation so concurrent webviews cannot both pass `will-attach-webview`.
- Registration of only a `webview` WebContents in the dedicated Session.
- Registry ownership/current guest lookup and cleanup only after guest destruction.
- Allowed and denied page navigation, redirect, and popup targets.
- Popup handler always returns `deny`, loads allowed targets in the same guest, and never creates a child.
- Fixed guest UserAgent and listener cleanup.

- [ ] **Step 2: Run the focused test and verify the expected failure**

```bash
pnpm exec vitest run tests/unit/web-browser-policy.test.ts
```

Expected: missing policy module and exports.

- [ ] **Step 3: Implement the registry and policy installer**

Export:

```ts
export class WebBrowserGuestRegistry {
  beginAttachment(): boolean;
  completeAttachment(guest: WebContents): void;
  cancelAttachment(): void;
  current(): WebContents | null;
  owns(contents: WebContents | null): boolean;
  hasLiveGuest(): boolean;
}

export function isExpectedWebBrowserAttachment(
  params: Record<string, unknown>,
): boolean;

export function hardenWebBrowserPreferences(
  preferences: WebPreferences,
): void;

export function installWebBrowserGuestPolicy(
  embedder: WebContents,
  options: {
    browserSession: Session;
    registry: WebBrowserGuestRegistry;
  },
): () => void;
```

Force `nodeIntegration`, subframe/worker Node integration, plugins, insecure content, and disabled web security off; force context isolation, sandbox, and web security on; delete preload. Reserve the slot synchronously in `will-attach-webview`, then complete registration in `did-attach-webview` after checking guest type and Session identity.

In `setWindowOpenHandler`, normalize the target, call the Main-owned guest `loadURL()` only for an allowed target, log rejection/failure, and always return `{ action: 'deny' }`. Add the approved comment explaining why same-tab behavior loses `window.opener`, POST/referrer fidelity, and window handles.

Use `will-navigate` and main-frame `will-redirect` to reject disallowed page-driven targets. Do not filter subframes or subresources. Treat `about:blank` as attachment-only, not a generally allowed destination.

- [ ] **Step 4: Run focused tests and Node type checking**

```bash
pnpm exec vitest run tests/unit/web-browser-policy.test.ts
pnpm run typecheck:node
```

Expected: all guest registry/policy tests pass and Electron types compile.

- [ ] **Step 5: Commit the task**

```bash
git add electron/main/web-browser-policy.ts tests/unit/web-browser-policy.test.ts
git commit -m "feat: harden web browser guest contents"
```

### Task 4: Configure Browser Session Permissions and Downloads

**Files:**
- Create: `electron/main/web-browser-session.ts`
- Modify: `shared/i18n/resources.ts`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/web-browser-session.test.ts`
- Test: `tests/unit/i18n-locale-parity.test.ts`

**Interfaces:**
- Consumes: `WebBrowserGuestRegistry`, shared browser constants, Electron Session permission APIs, and app language resolution.
- Produces: One configured persistent Session plus complete four-locale strings for native and Renderer browser UI.

- [ ] **Step 1: Write failing Session-policy tests**

Test that configuration:

- Gets `session.fromPartition(WEB_BROWSER_PARTITION, { cache: true })` once and sets the exact UA.
- Installs check/request permission handlers and one `will-download` listener.
- Returns true from permission checks only for `clipboard-read`, `clipboard-sanitized-write`, and `deprecated-sync-clipboard-read`.
- Grants clipboard variants immediately in the asynchronous permission-request handler without showing a dialog.
- Returns false for `media` checks so Chromium reaches the asynchronous request handler.
- Prompts only for registered-guest `media` requests containing audio/video.
- Uses one dialog for a combined camera/microphone request, includes the requesting origin, and maps Allow/Deny responses correctly.
- Rechecks guest ownership after the asynchronous dialog and denies a destroyed/replaced guest.
- Prompts again for a repeated media request.
- Denies geolocation with a product-limitation comment, and denies display capture and every other permission without a dialog.
- Calls every permission callback exactly once, including dialog failures.
- Leaves `will-download` uncancelled, never calls `setSavePath`, ignores user cancellation, and logs only interrupted completion.
- Does not call proxy configuration or close browser Session connections.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run tests/unit/web-browser-session.test.ts tests/unit/i18n-locale-parity.test.ts
```

Expected: missing Session module and locale keys/mapping.

- [ ] **Step 3: Add locale resources and Session policy**

Add `artifactPanel.tabs.webBrowser` plus matching keys under
`artifactPanel.webBrowser` in all four `chat.json` files for:

- Tab, Back, Forward, Refresh, More, Force Refresh, Clear Cookies, Clear Site Data, Open in System Browser.
- Address label/placeholder and each parser error.
- Load/clear/open errors and clear success text.
- Guest crash/recovery text.
- Native permission title, origin-aware message, camera, microphone, combined camera/microphone, Allow, and Deny.

Export a Main-consumable mapping from `shared/i18n/resources.ts`:

```ts
export type WebBrowserPermissionLabels =
  typeof enChat.artifactPanel.webBrowser.permissionDialog;

export const WEB_BROWSER_PERMISSION_LABELS:
  Record<LanguageCode, WebBrowserPermissionLabels>;
```

Implement:

```ts
export interface ConfigureWebBrowserSessionOptions {
  registry: WebBrowserGuestRegistry;
  getMainWindow: () => BrowserWindow | null;
  getLanguage?: () => Promise<string | undefined>;
  showMessageBox?: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
}

export function configureWebBrowserSession(
  options: ConfigureWebBrowserSessionOptions,
): Session;
```

Resolve current language at request time and fall back through the existing supported-language helper. The default `showMessageBox` wrapper must look up `dialog.showMessageBox` at call time so E2E can stub it after startup. Add the required comments for geolocation, default downloads, fixed macOS UA, and intentionally unsynchronized client proxy behavior.

- [ ] **Step 4: Run focused tests and locale parity**

```bash
pnpm exec vitest run tests/unit/web-browser-session.test.ts tests/unit/i18n-locale-parity.test.ts
pnpm run typecheck:node
```

Expected: permission/download tests and four-locale key/token parity pass.

- [ ] **Step 5: Commit the task**

```bash
git add electron/main/web-browser-session.ts shared/i18n/resources.ts shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/web-browser-session.test.ts tests/unit/i18n-locale-parity.test.ts
git commit -m "feat: configure web browser session policy"
```

### Task 5: Register Main Host Operations and Startup Ordering

**Files:**
- Create: `electron/services/web-browser-api.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Test: `tests/unit/web-browser-api.test.ts`
- Test: `tests/unit/host-services.test.ts`

**Interfaces:**
- Consumes: Shared URL policy, `WebBrowserGuestRegistry`, configured browser Session, `CompleteHostServiceRegistry`, and Electron shell.
- Produces: Working `webBrowser.navigate`, `clearCookies`, `clearSiteData`, and `openExternal` actions plus correctly ordered Main startup.

- [ ] **Step 1: Write failing Host service tests**

Test:

- `navigate({ url })` requires a live registered guest, normalizes an already absolute URL, rejects every unsupported/reserved target, and calls that guest's `loadURL()`.
- Clear Cookies calls only `clearStorageData({ storages: ['cookies'] })`.
- Clear Site Data calls `clearCache()` and `clearStorageData({ storages: ['cachestorage', 'localstorage', 'indexdb', 'serviceworkers'] })`; it never clears cookies.
- Open External reads `registry.current().getURL()` rather than accepting a Renderer URL, validates it, and calls `shell.openExternal(normalizedUrl)`.
- A standard file URL is passed to `shell.openExternal`; `shell.openPath` is never called.
- Missing/destroyed guest and `about:blank` external opening reject.
- Core service registration includes exactly one `webBrowser` module.

- [ ] **Step 2: Run focused tests and verify failures**

```bash
pnpm exec vitest run tests/unit/web-browser-api.test.ts tests/unit/host-services.test.ts
```

Expected: missing service and incomplete core registry.

- [ ] **Step 3: Implement the Host service**

Export:

```ts
export interface WebBrowserApiDependencies {
  browserSession: Session;
  registry: WebBrowserGuestRegistry;
  openExternal?: (url: string) => Promise<void>;
}

export function createWebBrowserApi(
  dependencies: WebBrowserApiDependencies,
): CompleteHostServiceRegistry['webBrowser'];
```

Keep all partition and storage-type choices in Main. Await clear operations completely before resolving so Renderer can safely force-refresh afterward.

- [ ] **Step 4: Wire startup before Renderer loading**

In `electron/main/index.ts`:

- Create one process-lifetime `WebBrowserGuestRegistry`.
- Configure the dedicated Session before `createMainWindow()`.
- Immediately after each `new BrowserWindow(...)`, install guest policy on the embedder before calling `loadURL()` or `loadFile()`.
- Pass the Session and registry into `registerIpcHandlers` and register `createWebBrowserApi` in `registerTypedHostHandlers`.
- Use `getMainWindow: () => mainWindow` so native dialogs target a recreated macOS window rather than a stale capture.
- Leave `electron/main/proxy.ts` unchanged; do not apply ClawX client proxy settings to the dedicated Session.
- Do not add preload channels or legacy `webBrowser:*` IPC handlers.

- [ ] **Step 5: Run Main tests and type checking**

```bash
pnpm exec vitest run tests/unit/web-browser-api.test.ts tests/unit/web-browser-policy.test.ts tests/unit/web-browser-session.test.ts tests/unit/host-services.test.ts tests/unit/host-api-facade.test.ts
pnpm run typecheck:node
```

Expected: service behavior, registry completeness, and Main types pass.

- [ ] **Step 6: Commit the task**

```bash
git add electron/services/web-browser-api.ts electron/main/index.ts electron/main/ipc-handlers.ts tests/unit/web-browser-api.test.ts tests/unit/host-services.test.ts
git commit -m "feat: register web browser host service"
```

### Task 6: Add the Artifact Tab and Stable Layout Anchor

**Files:**
- Create: `src/components/web-browser/WebBrowserAnchor.tsx`
- Modify: `src/stores/artifact-panel.ts`
- Modify: `src/components/file-preview/ArtifactPanel.tsx`
- Test: `tests/unit/artifact-panel-store.test.ts`
- Test: `tests/unit/artifact-panel.test.tsx`

**Interfaces:**
- Consumes: Existing artifact-panel state and tab button behavior.
- Produces: `web-browser` selection, one-time initialization, and an HTMLElement anchor consumed by the global host.

- [ ] **Step 1: Write failing store and panel tests**

Add assertions for:

- `ArtifactTab` distinguishes existing `browser` from `web-browser`.
- `webBrowserInitialized` starts false, becomes true when selected/opened, and remains true after switching tabs or closing the panel.
- `openWebBrowser()` opens, selects, and initializes the feature.
- `webBrowserAnchor` registration and cleanup do not affect initialization.
- Persisted state still contains only `widthPct`.
- The localized Web Browser tab appears exactly once and immediately after Changes.
- Clicking the tab selects `web-browser` and renders only `WebBrowserAnchor` in its body.
- The optional rich-preview folder action follows the four tabs.
- The tab row remains usable at minimum panel width rather than clipping the fourth localized label.

- [ ] **Step 2: Run focused tests and verify failures**

```bash
pnpm exec vitest run tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx
```

Expected: missing tab value, state, anchor, and tab control.

- [ ] **Step 3: Implement store and panel changes**

Extend state with:

```ts
webBrowserInitialized: boolean;
webBrowserAnchor: HTMLElement | null;
setWebBrowserAnchor: (anchor: HTMLElement | null) => void;
openWebBrowser: () => void;
```

Make `setTab('web-browser')` initialize the feature. Do not reset initialization from `close()`, session changes, route changes, or anchor cleanup. Keep both new fields out of persisted state.

Implement `WebBrowserAnchor` with a stable callback ref that registers/unregisters one empty `h-full min-h-0 w-full` sizing element. Add test IDs `artifact-panel-tab-web-browser`, `artifact-panel-tabs`, and `web-browser-anchor`. Give the tabs container horizontal overflow or reliable label truncation/tooltips so all four controls remain reachable.

- [ ] **Step 4: Run focused tests and Renderer type checking**

```bash
pnpm exec vitest run tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx
pnpm run typecheck:web
```

Expected: all tab/store tests pass and existing Workspace/Preview/Changes behavior remains intact.

- [ ] **Step 5: Commit the task**

```bash
git add src/components/web-browser/WebBrowserAnchor.tsx src/stores/artifact-panel.ts src/components/file-preview/ArtifactPanel.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx
git commit -m "feat: add web browser artifact tab"
```

### Task 7: Build the Browser Toolbar and Address Control

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/web-browser/WebBrowserAddressControl.tsx`
- Create: `src/components/web-browser/WebBrowserToolbar.tsx`
- Test: `tests/unit/web-browser-controls.test.tsx`

**Interfaces:**
- Consumes: Shared address parser, existing Button/Input/Tooltip primitives, Radix Dropdown Menu, and localized `artifactPanel.webBrowser` strings.
- Produces: Pure control components used by `WebBrowserHost`.

- [ ] **Step 1: Write failing control tests**

Cover:

- Document title display with URL fallback.
- Full URL in hover tooltip and accessible text even when visually truncated.
- Click-to-edit with current URL selected.
- Initial blank state focuses/selects the address input.
- Enter parses and emits the normalized URL.
- Escape and blur cancel without navigation.
- Invalid input remains in edit mode and emits the exact error code.
- Page URL changes do not overwrite a draft while the user is editing.
- Back/Forward disabled semantics, Refresh, Force Refresh, Clear Cookie, Clear Site Data, and Open External callbacks.
- Open External disabled on `about:blank`.
- Clear actions disable only while their matching operation runs.
- Controlled More menu closes when `visible` becomes false or `crashed` becomes true.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm exec vitest run tests/unit/web-browser-controls.test.tsx
```

Expected: missing dropdown and browser control components.

- [ ] **Step 3: Implement the reusable controls**

Export:

```ts
export function getWebBrowserDisplayText(title: string, url: string): string;
export function WebBrowserAddressControl(props: WebBrowserAddressControlProps): React.ReactElement;
export function WebBrowserToolbar(props: WebBrowserToolbarProps): React.ReactElement;
```

Use Radix portal/focus management and project surfaces (`bg-surface-modal`, `bg-surface-input`) in the dropdown wrapper. Use `Button variant="ghost"`, native `disabled`, localized tooltips/ARIA labels, and stable test IDs from the design. Do not create a bespoke outside-click implementation.

Keep the address draft independent while editing. On an invalid Enter, keep focus/edit mode and let the host map the error code to a localized Toast.

- [ ] **Step 4: Run focused tests and type checking**

```bash
pnpm exec vitest run tests/unit/web-browser-controls.test.tsx tests/unit/web-browser-url.test.ts
pnpm run typecheck:web
```

Expected: interaction, accessibility, and parsing tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add src/components/ui/dropdown-menu.tsx src/components/web-browser/WebBrowserAddressControl.tsx src/components/web-browser/WebBrowserToolbar.tsx tests/unit/web-browser-controls.test.tsx
git commit -m "feat: add web browser navigation controls"
```

### Task 8: Implement the Persistent Global WebView Host

**Files:**
- Create: `src/components/web-browser/WebBrowserHost.tsx`
- Create: `src/types/web-browser.ts`
- Modify: `src/components/layout/MainLayout.tsx`
- Test: `tests/unit/web-browser-host.test.tsx`
- Test: `tests/unit/main-layout.test.tsx`

**Interfaces:**
- Consumes: Artifact-panel initialization/anchor state, `WebBrowserToolbar`, Electron `WebviewTag`, and `hostApi.webBrowser`.
- Produces: One lazy, route-stable webview with synchronized UI, geometry, hidden-state semantics, clear actions, and crash recovery.

- [ ] **Step 1: Write failing host and layout tests**

Use a feature-local jsdom webview mock and test-local `ResizeObserver`. Cover:

- No webview before initialization and exactly one afterward.
- Fixed `src`, `partition`, `useragent`, and `allowpopups` attributes with no preload.
- The same DOM node survives tab switches, close/reopen, and anchor unregister/reregister.
- Hidden state uses visibility, pointer-events, `aria-hidden`, and `inert` rather than conditional unmounting.
- Immediate geometry and updates from `ResizeObserver`, window resize, visual viewport resize, and capture-phase scroll, coalesced with `requestAnimationFrame`.
- `did-attach`, loading, title, main-frame navigation, in-page navigation, and history availability synchronize toolbar state.
- Subframe failures and `ERR_ABORTED` (`-3`) are ignored; other main-frame failures Toast once.
- Address and recovery navigation call only `hostApi.webBrowser.navigate`; `webview.loadURL` is never called by Renderer code.
- Address/recovery navigation rejections are caught and produce one localized load error rather than an unhandled Promise rejection.
- Back, Forward, Refresh, and Force Refresh call the corresponding attached webview methods.
- Successful clear actions await Host API then force-refresh; failures Toast and do not refresh.
- Open External calls the no-argument Host API action.
- Open External rejections are caught and produce the localized external-open error.
- `render-process-gone` removes the failed element and shows recovery; user recovery creates one replacement at `about:blank`, waits for attachment, then sends the last allowed URL through Host API.
- MainLayout mounts one host outside routed `main-content`.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run tests/unit/web-browser-host.test.tsx tests/unit/main-layout.test.tsx
```

Expected: missing host/type module and MainLayout mount.

- [ ] **Step 3: Implement the stable host and event lifecycle**

Define with an explicit Electron type import:

```ts
import type { WebviewTag } from 'electron';

export type WebBrowserWebviewElement = HTMLWebViewElement & WebviewTag;
```

Use imperative `addEventListener` calls through a stable callback ref; remove every listener during ref/effect cleanup so React StrictMode does not duplicate handlers. Never key the guest by URL, route, panel state, or chat session. A generation key is allowed only after the crashed element has been removed and the user requests recovery.

Mount `WebBrowserHost` as a sibling of `<main>` inside MainLayout's stable inner shell. Position the host with `position: fixed` from the anchor's viewport `getBoundingClientRect()`. Keep fractional coordinates. Visibility requires panel open, active `web-browser` tab, a connected non-zero anchor, and a healthy guest.

Add the approved code comment beside the initialized-host rendering branch: removing the webview from the DOM destroys its guest, so inactive states must hide the host rather than unmount it.

When hiding a focused guest, make the host inert and move focus to the Web Browser tab or another safe app control so keyboard focus is not trapped in invisible content. Close any open Radix menu on hide/crash.

Keep `src="about:blank"` constant. On first creation, focus the address field. On recovery, wait for `did-attach` before calling `hostApi.webBrowser.navigate(lastKnownAllowedUrl)`.

Wrap every Host API call in an awaited handler with `try/catch`. Keep address editing active when Main rejects navigation, avoid duplicate Toasts when the same network failure also emits `did-fail-load`, and map external-open rejection to the dedicated localized error.

- [ ] **Step 4: Run focused regression tests and type checking**

```bash
pnpm exec vitest run tests/unit/web-browser-host.test.tsx tests/unit/web-browser-controls.test.tsx tests/unit/main-layout.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/host-api-facade.test.ts
pnpm run typecheck:web
```

Expected: one persistent guest in unit lifecycle tests, aligned geometry, correct controls, and no existing layout regressions.

- [ ] **Step 5: Commit the task**

```bash
git add src/components/web-browser/WebBrowserHost.tsx src/types/web-browser.ts src/components/layout/MainLayout.tsx tests/unit/web-browser-host.test.tsx tests/unit/main-layout.test.tsx
git commit -m "feat: keep web browser guest alive globally"
```

### Task 9: Add Deterministic Browser E2E Fixtures and Navigation Coverage

**Files:**
- Create: `tests/e2e/fixtures/web-browser.ts`
- Create: `tests/e2e/web-browser-navigation.spec.ts`

**Interfaces:**
- Consumes: Existing Electron fixture helpers, Browser Main APIs through `app.evaluate`, and the complete browser UI/Main policy.
- Produces: Local HTTP/file fixtures and E2E helpers reused by lifecycle and policy specs.

- [ ] **Step 1: Create failing navigation E2E scenarios**

Build a browser-specific fixture that binds `node:http` directly to `127.0.0.1` port `0` and serves deterministic routes for start/second pages, popup targets, UA echo, redirects, storage, permissions, downloads, cache, and Service Worker. Create local HTML files under the existing per-test `homeDir` and use `pathToFileURL()`.

Add Main snapshot helpers that return serializable guest ID, URL, title, UA, matching guest count, and BrowserWindow count. Identify guests by `getType() === 'webview'` and dedicated Session identity; do not use `electronApp.windows()` for guest counting.

Write tests for:

- Fixed tab order, no guest before first click, one guest afterward, initial `about:blank`, and focused address input.
- HTTP navigation, title/favicon display without a hover URL tooltip, Enter/Escape/blur, Back, Forward, Refresh, and Force Refresh while guest ID remains unchanged.
- `_blank` and `window.open()` allowed targets reuse the same guest and create no window/guest; disallowed popup and redirect targets do not navigate.
- Exact UA observed by both guest and server.
- Plain path rejection, standard `file:///` navigation, HTTP/file external opening through `shell.openExternal`, no `shell.openPath`, and disabled external opening at `about:blank`.

- [ ] **Step 2: Build and run the spec to observe failures before fixture/selector completion**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts --workers=1
```

Expected: new scenarios fail until fixture helpers/selectors and any integration defects are completed.

- [ ] **Step 3: Complete fixture instrumentation and fix only navigation defects**

Stub `shell.openExternal` and `shell.openPath` by replacing methods on Electron's live singleton and recording calls on serializable `globalThis` state. Keep all browsing local; do not access external internet.

Use stable `data-testid` selectors and poll Main snapshots for asynchronous guest changes. Do not pierce the webview with normal Playwright locators; execute guest assertions through Main `webContents.fromId(id)?.executeJavaScript()`.

- [ ] **Step 4: Run focused E2E and unit regressions**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts --workers=1
pnpm exec vitest run tests/unit/web-browser-url.test.ts tests/unit/web-browser-policy.test.ts tests/unit/web-browser-host.test.tsx
```

Expected: all local navigation, popup, UA, file, and external-open scenarios pass with one guest and one BrowserWindow.

- [ ] **Step 5: Commit the task**

```bash
git add tests/e2e/fixtures/web-browser.ts tests/e2e/web-browser-navigation.spec.ts
git commit -m "test: cover web browser navigation"
```

### Task 10: Cover Persistent Lifecycle, Geometry, and Crash Recovery

**Files:**
- Create: `tests/e2e/web-browser-lifecycle.spec.ts`
- Modify: `tests/e2e/fixtures/web-browser.ts`

**Interfaces:**
- Consumes: Browser E2E server/Main helpers and existing session/sidebar navigation fixtures.
- Produces: Acceptance coverage for the global host's lifetime and overlay geometry.

- [ ] **Step 1: Write failing lifecycle E2E tests**

Create one matrix test that establishes two-page history and guest DOM state, records guest ID, then verifies the same ID, URL, form/global state, and history after:

- Switching to Changes and back.
- Closing/reopening the artifact panel.
- Switching chat sessions and returning.
- Navigating to Settings and returning to Chat.

Add tests that compare `web-browser-host` and `web-browser-anchor` rectangles within a 1-2 pixel tolerance after panel-divider drag and actual BrowserWindow resize.

Add crash recovery coverage using `forcefullyCrashRenderer()`: recovery surface appears, the old guest is removed, one replacement receives a new ID, the last allowed URL is restored only after attachment, and history is not restored.

Add a same-`userDataDir` relaunch test: a cookie survives restart, no guest exists before first click after relaunch, and the new guest starts at `about:blank` without restored history.

- [ ] **Step 2: Build and run the lifecycle spec to verify failures**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-lifecycle.spec.ts --workers=1
```

Expected: any host unmounting, geometry lag, crash race, or accidental URL restoration is exposed.

- [ ] **Step 3: Fix lifecycle defects without changing scope**

Use polling around guest destruction/replacement and layout observation. Do not solve crash races by permitting concurrent guest registration. Do not persist URL/history. Do not suspend hidden pages.

- [ ] **Step 4: Run lifecycle and navigation E2E together**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts tests/e2e/web-browser-lifecycle.spec.ts --workers=1
```

Expected: both specs pass serially with isolated profiles.

- [ ] **Step 5: Commit the task**

```bash
git add tests/e2e/fixtures/web-browser.ts tests/e2e/web-browser-lifecycle.spec.ts
git commit -m "test: cover web browser lifecycle"
```

### Task 11: Cover Session Data, Permissions, Downloads, and Guest Security

**Files:**
- Create: `tests/e2e/web-browser-policy.spec.ts`
- Modify: `tests/e2e/fixtures/web-browser.ts`
- Modify: `tests/e2e/fixtures/electron.ts`

**Interfaces:**
- Consumes: Dedicated Session policy, local storage/download/permission pages, and Main instrumentation.
- Produces: End-to-end security and privileged-action acceptance coverage.

- [ ] **Step 1: Write failing policy E2E tests**

Add optional `additionalArgs?: string[]` to Electron launch options so media tests can use `--use-fake-device-for-media-stream` without `--use-fake-ui-for-media-stream`.

Test:

- Guest type/session/UA and absence of `window.electron`, `require`, and Node `process` in guest JavaScript.
- A second matching webview attachment is rejected and guest/window counts remain one.
- Clear Cookies removes cookies for at least two origins, keeps non-cookie site data, and force-refreshes.
- Clear Site Data removes HTTP cache, Cache Storage, Local Storage, IndexedDB, and Service Worker registrations, preserves cookies, and force-refreshes. Seed data only on explicit command so refresh does not recreate it.
- Combined camera/microphone request produces one origin-aware native dialog; Allow and Deny work; a repeated request produces a new dialog.
- Clipboard permission is allowed; geolocation and notifications are denied without a dialog.
- A deterministic attachment download reaches `will-download`, is not canceled or redirected by ClawX, and leaves the browser functional. Accept a native Save dialog awaiting user interaction; only require exact filename/bytes completion when the Electron/OS default flow proceeds unattended.

- [ ] **Step 2: Build and run the policy spec to verify failures**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-policy.spec.ts --workers=1
```

Expected: instrumentation or policy defects fail before final fixture support is complete.

- [ ] **Step 3: Complete safe Main instrumentation and fix policy defects**

Stub `dialog.showMessageBox` dynamically after launch, queue response indexes, and record only serializable options. Save and restore OS clipboard contents if the E2E writes them. Observe downloads from `session.fromPartition(WEB_BROWSER_PARTITION)`; never call `preventDefault`, `setSavePath`, or set a test download path in the acceptance path. Assert the observed destination/content rather than a hardcoded OS Downloads directory.

- [ ] **Step 4: Run all browser E2E specs and focused policy units**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts tests/e2e/web-browser-lifecycle.spec.ts tests/e2e/web-browser-policy.spec.ts --workers=1
pnpm exec vitest run tests/unit/web-browser-policy.test.ts tests/unit/web-browser-session.test.ts tests/unit/web-browser-api.test.ts
```

Expected: all browser UI, lifecycle, security, storage, permission, and download tests pass, including either verified default-flow completion or the native Save-dialog path on platforms that require interaction.

- [ ] **Step 5: Commit the task**

```bash
git add tests/e2e/fixtures/web-browser.ts tests/e2e/fixtures/electron.ts tests/e2e/web-browser-policy.spec.ts
git commit -m "test: cover web browser session policy"
```

### Task 12: Document User Behavior and Final Validation Anchors

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `README.ru-RU.md`
- Modify: `harness/reference/web-browser.md`
- Modify: `harness/reference/chat-workspace-and-navigation.md`
- Modify: `harness/specs/tasks/web-browser.md`

**Interfaces:**
- Consumes: Final implemented behavior and passing E2E selectors.
- Produces: Synchronized user documentation and durable implementation/validation references.

- [ ] **Step 1: Audit the implementation against the docs before editing**

Verify the final code and tests establish every documented limitation and exact value. Confirm title-state favicon behavior plus the absence of history persistence, password manager, extra tab/window, remembered permission, custom download path, or client-proxy synchronization.

- [ ] **Step 2: Update all four READMEs**

Add equivalent localized feature text covering:

- Fourth right-panel tab and single live page.
- Persistent cookies/site storage but no URL/history restoration after restart.
- Continued background execution while hidden across panel/session/route changes.
- HTTP/HTTPS/explicit `file:///` support and local-file exposure.
- Same-tab popup limitations including `window.opener`, POST/referrer, and window-handle incompatibility.
- Electron/OS default downloads, which may show a native Save dialog and require user interaction, with no custom path or manager.
- Per-request camera/microphone prompt, allowed clipboard, denied geolocation/other permissions.
- Clear Cookie versus Clear Site Data scope.
- System-proxy behavior and no ClawX client-proxy synchronization.
- `file:` external opening may use the OS-associated application.

- [ ] **Step 3: Finalize Harness references and task anchors**

Replace planned path descriptions with final symbol names and selectors. Ensure the task's `touchedAreas`, `requiredTests`, and acceptance list match the actual implementation. Keep the implementation task rooted in `gateway-backend-communication` and linked to `chat-workspace-and-navigation`.

- [ ] **Step 4: Validate docs and Harness structure**

```bash
pnpm harness validate --spec harness/specs/tasks/web-browser.md
pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/i18n-locale-parity.test.ts
```

Expected: real task validation passes without `--no-diff`, and Harness/locale tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md harness/reference/web-browser.md harness/reference/chat-workspace-and-navigation.md harness/specs/tasks/web-browser.md
git commit -m "docs: document web browser behavior"
```

### Task 13: Run Full Verification and Review

**Files:**
- Modify only files required to fix verification failures introduced by this feature.

**Interfaces:**
- Consumes: All implementation tasks and the real Harness task spec.
- Produces: A clean, reviewed worktree whose implementation and documentation pass project checks.

- [ ] **Step 1: Run static and unit validation**

```bash
pnpm run lint:check
pnpm run typecheck
pnpm test
```

Expected: zero lint errors, zero TypeScript errors, and all unit tests pass.

- [ ] **Step 2: Run communication and Harness validation**

```bash
pnpm run comms:replay
pnpm run comms:compare
pnpm run harness:ci
pnpm harness validate --spec harness/specs/tasks/web-browser.md
pnpm harness run --spec harness/specs/tasks/web-browser.md --continue-on-error
```

Expected: replay/compare remain within baseline, Harness CI passes, and the real task run reports no required-profile failure.

- [ ] **Step 3: Run Electron E2E**

First run the focused suite:

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/web-browser-navigation.spec.ts tests/e2e/web-browser-lifecycle.spec.ts tests/e2e/web-browser-policy.spec.ts --workers=1
```

Then run the full suite:

```bash
pnpm run test:e2e
```

Expected: focused and full Electron E2E pass. Headless Linux may emit harmless dbus errors documented in `AGENTS.md`.

- [ ] **Step 4: Inspect final scope and request code review**

Check `git status`, the complete diff from the design-spec commit, and every commit in this plan. Confirm no direct Renderer IPC, no guest preload, no extra browser instance, no client-proxy integration, and no unrelated refactoring. Use the `requesting-code-review` workflow and address every blocking finding.

- [ ] **Step 5: Commit verification fixes if needed**

If validation or review required code changes, stage only those fixes and commit them with a focused message such as:

```bash
git commit -m "fix: address web browser verification findings"
```

If no files changed, do not create an empty commit. End with `git status --short` returning no output.
