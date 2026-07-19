# ACP Attachment Open With Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, platform-aware `Open with` dropdown to previewable local AI attachment cards while preserving the existing primary preview action.

**Architecture:** Keep attachment authorization and operating-system interaction in Electron Main. A new platform service uses macOS Launch Services through JXA and Windows Shell association APIs through a bundled PowerShell/C# bridge, while `AttachmentAccess` revalidates the session-scoped file reference before listing, opening, or revealing. The Renderer receives only safe handler display metadata and renders a Radix dropdown as the secondary half of the existing attachment card.

**Tech Stack:** Electron 40, Node.js `child_process`, macOS AppKit/Foundation JXA, Windows PowerShell/C# Shell COM/PInvoke, React 19, TypeScript, Radix Dropdown Menu, react-i18next, Vitest, Playwright.

**Approved Design:** `docs/specs/2026-07-20-acp-attachment-open-with-design.md`

## Global Constraints

- Render the secondary action only for `tone === 'assistant'`, `access.status === 'available'`, `target.kind === 'local'`, and `attachmentOpenMode(...) === 'preview'`.
- Keep the primary button's translated `Preview {{name}}` accessible name and current preview behavior unchanged.
- Use sibling semantic buttons; never nest the `Open with` trigger inside the primary attachment button.
- macOS and Windows list every valid system handler, deduplicate by stable handler identity, put the default first, locale-sort the rest, and scroll rather than truncate the menu.
- Linux renders the secondary trigger but only the reveal-in-file-manager item; it does not run application discovery.
- Application discovery, helper startup, timeout, output parsing, individual metadata, and icon failures are silent. They must not display an error state or block preview/reveal. Missing icons use a generic icon.
- Only an explicitly selected application-open or reveal action may show a localized failure toast.
- Keep the reveal item available while application discovery is loading or after it fails.
- Invoke child processes with `shell: false`, a five-second timeout, a one-megabyte output cap, explicit argument arrays, a minimal sanitized Main-owned environment, no user-provided environment additions, and no Renderer-controlled source interpolation.
- Limit handler names to 256 UTF-16 code units, handler IDs to 512, native paths to 4,096, and icon PNG data URLs to 64 KiB.
- Cache list metadata/icons in Main for five minutes by platform and file-association key. Never cache attachment authorization. Application-specific open must perform a fresh, icon-free handler enumeration before invocation.
- Treat native handler names as private Main data. Windows exposes a deterministic SHA-256 handler ID derived from the native identity, never the native executable/canonical handler name itself.
- After fresh handler enumeration, re-resolve the attachment and recheck its session/generation immediately before the native invocation. Reject the action if its association key changed during enumeration.
- Never send executable paths, bundle paths, icon source paths, command templates, or canonical attachment paths to Renderer.
- Never include canonical file paths, application or bundle paths, icon-source paths, command lines, or icon data in logs or traces. Any optional open-with trace uses only the existing opaque attachment identity and bounded allowlisted fields.
- Use `src/lib/host-api.ts`; do not add direct Renderer IPC or Gateway HTTP calls.
- Add all user-facing strings to `en`, `zh`, `ja`, and `ru` chat locales and use existing surface, border, hover, and focus tokens.
- Follow test-driven development: add each focused failing test, observe the expected failure, then implement the minimum passing behavior.
- Do not alter unsupported/system-open-only attachment behavior, user attachments, remote URLs, preview format classification, or legacy Chat code.

---

### Task 1: Establish Harness Contract

**Files:**
- Create: `docs/plans/2026-07-20-acp-attachment-open-with.md`
- Create: `harness/specs/tasks/acp-attachment-open-with.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/attachment-access-safety.md`
- Modify: `harness/specs/rules/ui-i18n-design-tokens.md`
- Modify: `harness/reference/acp-attachment-access-control.md`

**Interfaces:**
- Consumes: Approved behavior and security decisions from `docs/specs/2026-07-20-acp-attachment-open-with-design.md`.
- Produces: Harness task id `acp-attachment-open-with`, updated attachment authorization rules, and validation requirements consumed by all implementation tasks.

- [ ] **Step 1: Write the task spec before implementation**

Create `harness/specs/tasks/acp-attachment-open-with.md` with:

- `scenario: gateway-backend-communication` and `taskType: runtime-bridge`.
- `touchedAreas` covering the approved design, this plan, the new platform service and Windows resource script, Windows CI/release workflow checks, host contract and services, `AcpAttachmentPart`, all four chat locale files, focused unit/E2E tests, three READMEs, and the harness files in this task.
- `requiredProfiles: [fast, comms, e2e]`.
- Rules for renderer/Main boundaries, host API fallback, attachment access safety, UI/i18n, comms regression, and docs sync.
- Required commands copied from Task 6.
- Acceptance entries for split-button behavior, macOS/Windows handlers and icons, Linux reveal-only behavior, fresh Main validation, silent discovery/icon degradation, and absence of raw paths/commands in Renderer.
- An acceptance traceability table linking deterministic platform behavior to `tests/unit/attachment-open-with.test.ts`, native bridge validity to `tests/unit/attachment-open-with-native.test.ts`, authorization to `tests/unit/attachment-access.test.ts`, UI to `tests/unit/acp-chat-components.test.tsx`, and end-to-end behavior to `tests/e2e/chat-acp-attachments.spec.ts`.

- [ ] **Step 2: Extend durable scenario and rules**

Update `harness/specs/scenarios/acp-chat-experience.md` so its owned paths include `electron/services/attachment-open-with.ts`, `resources/scripts/attachment-open-with.ps1`, `tests/unit/attachment-open-with.test.ts`, and `tests/unit/attachment-open-with-native.test.ts`; describe attachment-specific open/reveal as part of the user-visible ACP attachment flow.

Update `attachment-access-safety.md` to require:

- Attachment-scoped list, selected-handler open, and reveal operations.
- Per-operation ref/session/generation re-resolution.
- Fresh handler membership validation before application-specific open.
- No Renderer-provided executable/application path or command.
- Silent discovery/icon failure isolation.

Update `ui-i18n-design-tokens.md` to require the separate primary/secondary semantic controls, keyboard-accessible dropdown, four-locale labels, and generic icon fallback.

Update `harness/reference/acp-attachment-access-control.md` with the new typed operations, stable-handler identity as non-authority, platform ownership, five-minute display cache versus fresh action validation, and reveal routing.

- [ ] **Step 3: Validate the harness task**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/acp-attachment-open-with.md
```

Expected: validation succeeds without `--no-diff`, selects the `fast`, `comms`, and `e2e` profiles, and reports no missing rule or reference.

- [ ] **Step 4: Commit the harness contract**

```bash
git add docs/plans/2026-07-20-acp-attachment-open-with.md harness/specs/tasks/acp-attachment-open-with.md harness/specs/scenarios/acp-chat-experience.md harness/specs/rules/attachment-access-safety.md harness/specs/rules/ui-i18n-design-tokens.md harness/reference/acp-attachment-access-control.md
git commit -m "docs(harness): specify attachment open-with flow"
```

---

### Task 2: Implement Platform Handler Service

**Files:**
- Create: `electron/services/attachment-open-with.ts`
- Create: `resources/scripts/attachment-open-with.ps1`
- Create: `tests/unit/attachment-open-with.test.ts`
- Create: `tests/unit/attachment-open-with-native.test.ts`
- Modify: `.github/workflows/check.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Canonical local file paths supplied only by `AttachmentAccess`; Electron `app.getFileIcon`; OS association APIs.
- Produces: `AttachmentOpenWithService`, `SystemOpenHandler`, and `createAttachmentOpenWithService()` for Task 3.

Define the internal interface exactly as:

```ts
export type OpenWithPlatform = 'darwin' | 'win32' | 'linux';

export type SystemOpenHandler = {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault: boolean;
};

export type AttachmentOpenWithService = {
  platform: OpenWithPlatform;
  list(filePath: string): Promise<SystemOpenHandler[]>;
  open(
    filePath: string,
    handlerId: string,
    revalidateFile: () => Promise<string>,
  ): Promise<void>;
};

export function createAttachmentOpenWithService(
  dependencies?: AttachmentOpenWithDependencies,
): AttachmentOpenWithService;
```

`AttachmentOpenWithDependencies` must permit injecting platform, clock, bounded `execFile`, interactive `spawn`, icon loading, and helper path resolution so all platform behavior is deterministic in Vitest.

- [ ] **Step 1: Write failing platform-service tests**

Create node-environment tests covering:

- macOS parsing of multiple JXA records with Unicode/space-containing bundle paths.
- Windows parsing of desktop and packaged/UWP handler records.
- Windows public IDs are deterministic SHA-256 values derived from platform plus native handler identity; tests assert the native identity/path is absent from the public result.
- Duplicate removal by stable ID, default-first ordering, and retention of non-default OS order before Renderer sorting.
- Rejection of control characters and over-limit IDs, names, and paths without rejecting valid sibling records.
- Five-minute cache hits for `list`, cache refresh after expiry, and no cache use by `open` action-time validation.
- Per-handler macOS JXA PNG parsing and Windows `app.getFileIcon` conversion, 64 KiB rejection, and icon exceptions degrading to missing `iconDataUrl`.
- Five-second timeout, one-megabyte `maxBuffer`, `shell: false`, explicit arguments, a sanitized Main-owned process environment that excludes user/Renderer-provided additions, and malformed JSON producing an empty list rather than a thrown discovery error.
- Linux `list` returning `[]` without process execution and `open` rejecting as unsupported.
- `open` rejecting unknown/stale IDs after fresh enumeration, never invoking the OS for an unknown ID, then calling `revalidateFile` after the helper's ready handshake and immediately before native invocation.
- Generation/ref revalidation failure after a delayed fresh enumeration prevents native invocation; a changed association key is rejected rather than invoking a handler enumerated for a different type.
- The Windows `prepare-open` helper receives the initial Main-owned canonical path and opaque handler ID as separate positional arguments, enumerates that path's association exactly once, emits exactly one `ready` record after retaining the matched COM handler, performs no second enumeration, accepts exactly one bounded `invoke` message containing only the post-ready `revalidateFile` path, and exits without invoking on callback failure, association-key mismatch, timeout, malformed input, cancellation, or stdin close.
- Packaged and development Windows helper path resolution under `process.resourcesPath/resources/scripts` and `<appPath>/resources/scripts`.
- A fake packaged resource tree containing `resources/resources/scripts/attachment-open-with.ps1` is resolved and executed through the injected executor path; the test also verifies the source helper is covered by the global `resources/**/*` rule in `electron-builder.yml`.

- [ ] **Step 2: Run the tests and verify the missing implementation failure**

```bash
pnpm exec vitest run tests/unit/attachment-open-with.test.ts
```

Expected: failure because `electron/services/attachment-open-with.ts` and the helper script do not exist.

- [ ] **Step 3: Implement bounded process and normalization helpers**

In `electron/services/attachment-open-with.ts`:

- Add constants `PROCESS_TIMEOUT_MS = 5_000`, `PROCESS_MAX_BUFFER_BYTES = 1_048_576`, `HANDLER_NAME_MAX_LENGTH = 256`, `HANDLER_ID_MAX_LENGTH = 512`, `NATIVE_PATH_MAX_LENGTH = 4_096`, `ICON_DATA_URL_MAX_BYTES = 65_536`, and `CACHE_TTL_MS = 300_000`.
- Wrap `execFile` once with timeout, maxBuffer, UTF-8 output, `windowsHide: true`, and `shell: false`. Add a separate bounded `spawn` wrapper for the Windows prepare/ready/invoke handshake with the same five-second lifetime, one-megabyte aggregate stdout/stderr cap, `windowsHide: true`, and `shell: false`. Both wrappers construct a minimal Main-owned environment from explicitly allowed platform keys and never merge payload-, dependency-, user-, or Renderer-provided environment additions.
- Parse helper JSON as unknown, validate each record independently, remove malformed entries, and return `[]` for whole-helper startup/timeout/JSON failures.
- Derive Windows public handler IDs with SHA-256 over a fixed `win32\0` prefix plus the private native canonical handler identity. Store the identity-to-public-ID relationship only in private list/cache records and recompute it during fresh enumeration.
- Keep native application/icon paths in an internal record type only. Validate macOS JXA base64 output as a PNG and convert valid Windows Electron `NativeImage` values to PNG data URLs; discard malformed, empty, or oversized values and catch each icon independently.
- Cache only normalized list data and private native metadata by `${platform}:${associationKey}`. Derive the association key from a normalized lower-case extension; use the full lower-case basename only when no extension exists.
- Normalize helper and process failures to bounded reason codes without logging process arguments, helper output, canonical paths, native application/bundle/icon-source paths, command lines, or icon data.

- [ ] **Step 4: Implement the macOS adapter**

Use `/usr/bin/osascript -l JavaScript` with a static JXA program and positional arguments. The JXA program must import Foundation/AppKit, create an `NSURL.fileURLWithPath`, call `NSWorkspace` APIs to enumerate application URLs and resolve the default application, and emit JSON records containing bundle ID, localized name, and bundle path.

For `list`, pass an explicit icon mode to the JXA bridge. Use `NSWorkspace.iconForFile()` to render each bundle icon to a 32-point PNG and return bounded base64 alongside the private native record. Main validates base64 syntax, the PNG signature, and the 64 KiB data-URL limit. Do not fall back to Electron's generic bundle icon when native icon export fails.

For `open`, perform a fresh JXA enumeration without icon work and require an exact bundle-ID match. Then await `revalidateFile()`, require the returned path to have the same association key as the path just enumerated, and call `/usr/bin/open` with `['-a', matchedBundlePath, revalidatedPath]`. Do not accept a bundle path from the caller.

- [ ] **Step 5: Implement the Windows bridge and adapter**

Create `resources/scripts/attachment-open-with.ps1` with `list` and `prepare-open` modes. Its embedded C# must:

- Declare the documented `SHAssocEnumHandlers`, `AssocQueryString`, `IAssocHandler`, Shell item/data-object APIs, and required COM interfaces.
- Enumerate handlers for the extension, reading stable canonical handler name, localized UI name, and icon location/index.
- Determine the default executable/association and mark the matching handler.
- In `prepare-open` mode, accept the initial Main-owned canonical path and public opaque handler ID as separate positional arguments. Derive the association only from that initial path, enumerate it once, compute `SHA256(UTF8("win32\0" + nativeIdentity))` for each native identity, require an exact public opaque-ID match, and retain that `IAssocHandler` COM object in the same helper process. The initial path is supplied by Main's pre-action attachment resolution and never by Renderer.
- Emit and flush one bounded JSON line `{ "ready": true }`, then wait on stdin without re-enumerating. Accept exactly one JSON command containing `{ "command": "invoke", "path": <revalidated canonical path> }`; on EOF, `cancel`, malformed input, or timeout, release the retained handler and exit without invoking.
- After the invoke command, create a Shell data object for the revalidated canonical file and invoke the retained `IAssocHandler`; never parse or execute a registry command template.
- Emit only bounded JSON records/status and exit non-zero for a selected-handler invocation failure.

For listing, invoke `powershell.exe` with `-NoLogo`, `-NoProfile`, `-NonInteractive`, `-ExecutionPolicy Bypass`, `-File`, helper path, `list`, and extension/path as separate arguments. For opening, spawn the same executable in `prepare-open` mode with the initial Main-owned canonical path and public opaque handler ID as separate arguments, so the retained handler comes from a fresh enumeration of that path's association. Wait for its `ready` line, await `revalidateFile()`, require the returned path to have the same association key as the initial path, then write the invoke JSON containing only that revalidated canonical path. The retained handler must invoke solely with this post-ready path. Kill/close the helper without invocation if revalidation fails or the association key differs. List failures return `[]`; an explicit prepare/invoke failure rejects so Task 3 can return `operationFailed`. No path argument originates in Renderer.

For icons, call `app.getFileIcon()` only with a validated private icon source or associated executable path. Keep handlers whose icons cannot be resolved.

- [ ] **Step 6: Run focused tests**

```bash
pnpm exec vitest run tests/unit/attachment-open-with.test.ts
```

Expected: all platform, cache, bounds, silent-degradation, and safe-process tests pass on every host platform using injected executors.

- [ ] **Step 7: Add and run platform-gated native smoke tests**

Create `tests/unit/attachment-open-with-native.test.ts` with explicit platform gates:

- On macOS, create a temporary `.txt` file, run the real static JXA list program through `/usr/bin/osascript`, and assert valid JSON plus at least one bounded application record. Do not invoke an application.
- On Windows, create a temporary `.txt` file, run the real source PowerShell helper in `list` mode, and assert that embedded C# compilation, `SHAssocEnumHandlers` enumeration, and real default-handler identification complete with valid JSON. Start `prepare-open` with that Main-owned temporary canonical path and a guaranteed non-matching opaque ID as separate arguments, then assert a bounded non-zero exit without application invocation.
- On Linux, mark both native bridge cases skipped while retaining the deterministic injected-executor coverage.
- In all environments, stage the helper under a fake packaged `resources/resources/scripts` tree and assert packaged path resolution reads that exact file.

Run:

```bash
pnpm exec vitest run tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts
```

Expected: deterministic tests pass everywhere; the current host's native bridge smoke test passes and the other platform bridge is explicitly skipped.

- [ ] **Step 8: Wire native and packaged-resource checks into Windows CI**

In `.github/workflows/check.yml`, add a Windows build-job step after dependency installation:

```yaml
- name: Test Windows attachment open-with bridge
  run: pnpm exec vitest run tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts
```

In `.github/workflows/release.yml`, add the same native bridge test for `matrix.platform == 'win'` before packaging. Immediately after `pnpm run package:win`, add a PowerShell step that recursively locates the unpacked `resources/resources/scripts/attachment-open-with.ps1`, fails if exactly one non-empty helper is not present, and compares its SHA-256 hash with the source `resources/scripts/attachment-open-with.ps1`. This validates actual electron-builder output rather than only source path resolution.

- [ ] **Step 9: Commit the platform service and CI checks**

```bash
git add electron/services/attachment-open-with.ts resources/scripts/attachment-open-with.ps1 tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts .github/workflows/check.yml .github/workflows/release.yml
git commit -m "feat: add attachment open-with platform service"
```

---

### Task 3: Add Secure Attachment Host Operations

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/attachment-access.ts`
- Modify: `electron/services/files-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `tests/unit/attachment-access.test.ts`
- Modify: `tests/unit/host-api-facade.test.ts`
- Modify: `tests/unit/host-services.test.ts`

**Interfaces:**
- Consumes: `AttachmentOpenWithService` from Task 2 and existing `AttachmentFileRef` session authority.
- Produces: Shared `AttachmentOpenHandler`, `AttachmentOpenHandlersResult`, `OpenAttachmentWithPayload`, and the three `hostApi.files` methods consumed by Task 4 and the E2E fixture.

- [ ] **Step 1: Write failing contract and attachment-boundary tests**

Extend `tests/unit/host-api-facade.test.ts` to call and assert exact host requests for:

```ts
hostApi.files.listAttachmentOpenHandlers(ref);
hostApi.files.openAttachmentWith({ ref, handlerId: 'com.apple.Preview' });
hostApi.files.revealAttachment(ref);
```

Extend `tests/unit/host-services.test.ts` so `createFilesApi` delegates all three methods to injected `attachmentAccess` and returns `operationFailed` fallbacks when the dependency is absent.

Extend `tests/unit/attachment-access.test.ts` with injected `openWith` and `showItemInFolder` mocks covering:

- Valid local list returns safe handler fields and current platform.
- Linux returns an empty successful list.
- Remote, stale-session, missing, and non-file refs are rejected for all three operations.
- Listing and opening files outside the workspace remain allowed after existing exact ref validation.
- A forged handler ID reaches only the platform service's fresh membership check and never reaches native OS invocation; the no-native-invocation assertion lives in `tests/unit/attachment-open-with.test.ts`.
- `openAttachmentWith` resolves the ref, then passes `AttachmentOpenWithService.open` a `revalidateFile` callback that re-resolves the original ref and rechecks generation after fresh handler enumeration.
- Generation invalidation during delayed fresh handler enumeration causes `revalidateFile` to reject before native invocation; reveal likewise validates immediately before `showItemInFolder`.
- Reveal passes only the re-resolved canonical path to `showItemInFolder`.
- Capture diagnostics around list, selected-handler open, and reveal using sentinel canonical file, application/bundle, icon-source, command-line, and icon-data values; assert no serialized log or trace contains them. If an optional open-with trace is emitted, assert it contains only the opaque attachment identity and bounded allowlisted fields.

- [ ] **Step 2: Run focused tests and verify missing API failures**

```bash
pnpm exec vitest run tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
```

Expected: new tests fail because the shared contract, facade methods, and `AttachmentAccess` operations are absent.

- [ ] **Step 3: Add shared contract and Renderer facade**

Add these contract types near the existing attachment types:

```ts
export type AttachmentOpenHandler = {
  handlerId: string;
  name: string;
  iconDataUrl?: string;
  isDefault: boolean;
};

export type AttachmentOpenHandlersResult =
  | {
      ok: true;
      platform: 'darwin' | 'win32' | 'linux';
      handlers: AttachmentOpenHandler[];
    }
  | {
      ok: false;
      error: AttachmentAccessError | 'unsupportedPlatform' | 'operationFailed';
    };

export type OpenAttachmentWithPayload = {
  ref: AttachmentFileRef;
  handlerId: string;
};
```

Add Promise-returning `files` contract methods and matching facade calls in `src/lib/host-api.ts`. Export the result and handler types from the facade's existing type-export block where Renderer tests need them.

- [ ] **Step 4: Integrate the service into AttachmentAccess**

Extend `AttachmentAccessDependencies` with an injected `openWith` service and extend the shell dependency with `showItemInFolder`.

Implement:

```ts
listAttachmentOpenHandlers(ref: AttachmentFileRef): Promise<AttachmentOpenHandlersResult>;
openAttachmentWith(payload: OpenAttachmentWithPayload): Promise<OpenAttachmentResult>;
revealAttachment(ref: AttachmentFileRef): Promise<OpenAttachmentResult>;
```

Each method must call the existing `resolveTarget`, require `kind === 'local'`, require an active matching session/generation, and return existing attachment access errors. Reveal repeats local target resolution and generation validation immediately before `showItemInFolder`. Open validates `handlerId` as a non-empty bounded string, then delegates the initial Main-owned canonical path and handler ID to the platform service together with a callback that repeats local target resolution and generation validation after fresh handler enumeration and returns the latest canonical path. Never log or trace canonical file paths, application/bundle/icon-source paths, command lines, or icon data. If optional tracing is added, emit only the existing opaque attachment identity and bounded allowlisted fields.

For discovery, map `SystemOpenHandler.id` to public `handlerId` and return only safe display fields. Expected helper startup, timeout, malformed output, and per-entry parsing failures are already normalized by the platform service to `[]`, so return `{ ok: true, platform, handlers: [] }`. Return `{ ok: false, error: <attachment error> }` for ref authorization failures and `{ ok: false, error: 'operationFailed' }` only for unexpected service exceptions. Linux always returns `{ ok: true, platform: 'linux', handlers: [] }`.

- [ ] **Step 5: Wire files service and production construction**

Delegate the three methods from `createFilesApi`, with safe failure results when `attachmentAccess` is absent. In `electron/main/ipc-handlers.ts`, create one `AttachmentOpenWithService` and inject it into the single production `createAttachmentAccess` instance. Do not add legacy IPC channels.

- [ ] **Step 6: Run focused and type tests**

```bash
pnpm exec vitest run tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
pnpm run typecheck:node
pnpm run typecheck:web
```

Expected: all focused tests and both TypeScript projects pass; no Renderer-facing type contains native paths or commands.

- [ ] **Step 7: Commit the host boundary**

```bash
git add shared/host-api/contract.ts electron/services/attachment-access.ts electron/services/files-api.ts electron/main/ipc-handlers.ts src/lib/host-api.ts tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
git commit -m "feat: expose secure attachment open-with actions"
```

---

### Task 4: Build The Split Attachment Card

**Files:**
- Modify: `src/pages/Chat/AcpAttachmentPart.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Modify: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: `hostApi.files.listAttachmentOpenHandlers`, `openAttachmentWith`, and `revealAttachment` from Task 3.
- Produces: The user-visible split card and accessible dropdown exercised by Task 5.

- [ ] **Step 1: Write failing component tests**

Extend the existing attachment cases in `tests/unit/acp-chat-components.test.tsx` and its `hostApi` mock. Cover:

- The trigger appears only for an assistant, available, local, preview-mode attachment.
- The trigger is absent for user tone, pending/unavailable, remote, and system-open-only/oversized attachments.
- The primary button retains exact accessible name `Preview report.pdf` and still calls `openPreview` without calling any new host operation.
- The trigger has a separate accessible name `Open report.pdf with`, opens a keyboard-accessible menu, and does not activate preview.
- macOS/Windows discovery shows a loading row while pending, leaves reveal enabled, puts `isDefault` first, locale-sorts the rest, and renders the native icon data URL.
- Missing, oversized-looking, or image-load-failed icons render a generic application icon.
- Rejected/failed discovery removes the loading/application section with no toast or failure row while reveal remains available.
- Selecting an application sends the exact ref and handler ID; only explicit action failure produces `openWithFailed` toast.
- Reveal uses `revealAttachment`, has Finder/Explorer/file-manager text based on `window.electron.platform`, and only explicit failure produces `revealFailed` toast.
- Linux skips `listAttachmentOpenHandlers` and renders only the reveal item.
- Closing and reopening requests discovery again; stale promises after close, ref change, or unmount do not populate a later menu.
- Escape closes the menu and returns focus to the trigger.

- [ ] **Step 2: Run the component test and verify expected failures**

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx
```

Expected: the new trigger/menu assertions fail because `AcpAttachmentPart` is still a single button.

- [ ] **Step 3: Add four-locale strings**

Add matching keys under `acp.attachment` in all four locale files:

```text
openWith
openWithFile
searchingApplications
showInFinder
showInExplorer
showInFileManager
openWithFailed
revealFailed
```

Use natural translations, preserve the `{{name}}` interpolation in `openWithFile`, and do not hardcode Finder/Explorer labels in React.

- [ ] **Step 4: Refactor eligible cards into sibling controls**

Keep the current single-button branches unchanged for ineligible cards and user image thumbnails. For an eligible assistant local preview attachment:

- Render one card-shaped `div` with the current border/surface styling.
- Render the primary file-information button as `flex-1 min-w-0`, preserving `aria-label`, file content, click behavior, focus ring, and rounded left corners.
- Add a visually integrated right-side trigger with a left separator, translated label, chevron, its own focus ring, and rounded right corners.
- Use `@radix-ui/react-dropdown-menu` directly; do not add a generic component wrapper that is unused elsewhere.

- [ ] **Step 5: Implement lazy menu state and actions**

On each open transition:

- macOS/Windows: clear old handlers, show the disabled loading item, call list with the local `AttachmentFileRef`, ignore stale responses with a monotonically increasing request token, silently map failure/throw to `[]`, then sort default first and remaining names with `Intl.Collator(i18n.language)`.
- Linux: do not call list; render only reveal.
- Always render a separator before reveal only when at least one application row or loading row exists.
- Render menu content in a portal, align it to the trigger end, cap height with vertical scrolling, and use `bg-surface-modal`, semantic border, shadow, hover, and focus styles.
- Validate icon values as bounded `data:image/png;base64,` strings before rendering. Use a small row component or local state to replace image `onError` with a Lucide generic application icon.
- Call `openAttachmentWith` or `revealAttachment` from menu selection handlers. Catch only explicit action failures for localized toast display.

- [ ] **Step 6: Run focused UI and regression tests**

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/rich-file-viewers.test.tsx
pnpm run typecheck:web
```

Expected: split-card, eligibility, silent degradation, platform labels, keyboard behavior, and existing preview tests pass.

- [ ] **Step 7: Commit the Renderer behavior**

```bash
git add src/pages/Chat/AcpAttachmentPart.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/acp-chat-components.test.tsx
git commit -m "feat(chat): add attachment open-with menu"
```

---

### Task 5: Cover The Electron Interaction End To End

**Files:**
- Modify: `tests/e2e/fixtures/electron.ts`
- Modify: `tests/e2e/chat-acp-attachments.spec.ts`

**Interfaces:**
- Consumes: Renderer controls from Task 4 and typed host operations from Task 3.
- Produces: Electron-level regression coverage for click routing, host requests, silent degradation, and platform-specific menu content.

- [ ] **Step 1: Write the failing E2E scenarios**

Add focused tests that create a previewable assistant local spreadsheet/PDF attachment and assert:

- The card has both `Preview <name>` and `Open <name> with` controls.
- Opening the menu records `files.listAttachmentOpenHandlers` with the exact attachment ref.
- On macOS/Windows, mocked handlers render default-first with icon/fallback rows; selecting one records `files.openAttachmentWith` and does not open the artifact panel.
- Selecting the platform reveal item records `files.revealAttachment`.
- Clicking the primary button still opens the artifact preview and does not record either explicit secondary action.
- A configured discovery failure leaves reveal visible and shows no failure toast/row.
- User attachments, remote resources, unavailable refs, and ZIP/system-open cards do not expose the trigger.
- On Linux, conditionally assert that the menu contains only the generic file-manager reveal item and records no discovery request. On macOS/Windows, conditionally assert the native platform label and application list. This lets the same spec validate the correct branch on each CI host without a production platform override.

- [ ] **Step 2: Run the E2E test and verify the fixture failure**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
```

Expected: the new tests fail at compile time or their first fixture call because `setOpenHandlersResult` and the three fixture host routes do not exist yet; existing attachment cases remain unchanged.

- [ ] **Step 3: Extend the attachment E2E fixture**

Add fixture state and methods:

```ts
setOpenHandlersResult(result: {
  ok: boolean;
  platform?: 'darwin' | 'win32' | 'linux';
  handlers?: Array<{
    handlerId: string;
    name: string;
    iconDataUrl?: string;
    isDefault: boolean;
  }>;
  error?: string;
}): Promise<void>;
```

Record and answer `files.listAttachmentOpenHandlers`, `files.openAttachmentWith`, and `files.revealAttachment` in the fixture host handler. Return configured handler data for discovery and `{ ok: true }` for explicit actions. Add `showItemInFolder` to the instrumented Electron shell so attachment-scoped reveal can also be asserted when routed through production access.

Do not execute real system applications in E2E.

- [ ] **Step 4: Complete fixture routing and stabilize selectors**

Use explicit test IDs only for the new trigger, menu, app row, loading row, and reveal row where role/name selectors are ambiguous. Keep user-facing assertions role-based. Ensure the fixture records typed host actions through `host:invoke` and does not add legacy IPC mocks.

- [ ] **Step 5: Re-run focused E2E**

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
```

Expected: all ACP attachment E2E cases pass on the current host platform, including the platform-conditional branch and no legacy IPC invocations.

- [ ] **Step 6: Commit E2E coverage**

```bash
git add tests/e2e/fixtures/electron.ts tests/e2e/chat-acp-attachments.spec.ts
git commit -m "test(e2e): cover attachment open-with menu"
```

---

### Task 6: Sync Documentation And Run Full Validation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify if validation requires correction: `harness/specs/tasks/acp-attachment-open-with.md`

**Interfaces:**
- Consumes: Completed platform, host, UI, and E2E behavior from Tasks 2-5.
- Produces: User-facing documentation and a fully validated implementation ready for review.

- [ ] **Step 1: Update attachment behavior documentation**

In the ACP attachment paragraph of all three READMEs, add that previewable AI-produced local attachments keep their in-app preview action and provide a secondary menu for compatible applications plus reveal-in-Finder/File Explorer/file-manager. State that application discovery is macOS/Windows only and silently degrades to reveal-only behavior. Preserve the existing explanation of session/generation validation and system/default opening for unsupported attachments.

- [ ] **Step 2: Run focused unit tests**

```bash
pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/rich-file-viewers.test.tsx
```

Expected: all focused harness, platform, authorization, host facade, and Renderer tests pass.

- [ ] **Step 3: Run static validation and build**

```bash
pnpm run typecheck
pnpm run lint:check
pnpm run build:vite
```

Expected: both TypeScript projects, ESLint, and the production Vite/Electron bundle complete without errors. Do not run the repository-wide auto-fix command during final validation. If a check fails, return to the owning task, make the smallest manual correction with `apply_patch`, rerun that task's focused tests, and create a new non-amended fix commit containing exactly the corrected files before resuming this task.

- [ ] **Step 4: Run Electron E2E**

```bash
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
```

Expected: the complete attachment E2E spec passes with no legacy IPC invocation.

- [ ] **Step 5: Run communication and harness validation**

```bash
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/acp-attachment-open-with.md
pnpm harness run --spec harness/specs/tasks/acp-attachment-open-with.md
pnpm run harness:ci
```

Expected: communication metrics remain within baseline, the real task spec validates without `--no-diff`, its selected workflow passes, and CI-parity harness checks pass.

- [ ] **Step 6: Inspect the final change set**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~5
```

Confirm that no direct Renderer IPC, raw application/canonical paths in Renderer contracts, registry command execution, user-provided child-process environment addition, unrelated refactor, generated test artifact, or secret was added. Confirm Windows `prepare-open` receives a Main-owned initial association input separately from the opaque handler ID, invokes only with the post-ready revalidated path, and rejects association-key changes. Confirm logs/traces contain no canonical file, application/bundle/icon-source path, command line, or icon data; any optional trace contains only opaque attachment identity and bounded fields. Confirm discovery/icon errors have no toast or visible failure row.

- [ ] **Step 7: Commit documentation or validation fixes**

```bash
git add README.md README.zh-CN.md README.ja-JP.md harness/specs/tasks/acp-attachment-open-with.md
git commit -m "docs: describe attachment open-with behavior"
```

If `harness/specs/tasks/acp-attachment-open-with.md` did not change after Task 1, stage only the three README files. Do not amend earlier commits.
