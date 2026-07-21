# ACP Attachment Open With Design

Date: 2026-07-20
Status: Approved

## Summary

Add an in-card `Open with` action to local, previewable AI attachment cards in ACP chat. The existing primary card action continues to open ClawX's preview panel. A compact separate button inside the card's right edge opens a dropdown containing compatible system applications followed by a fixed reveal-in-file-manager action.

The feature supports application discovery and application-specific opening on macOS and Windows. Linux shows the same secondary action with only the reveal-in-file-manager item. Application discovery, metadata, and icon failures degrade silently and never block previewing or revealing the file.

## Goals

- Preserve the current behavior and accessible name of the main `Preview <filename>` attachment action.
- Add a distinct `Open with` action that does not activate the main preview action.
- List every compatible application reported by the operating system, deduplicated with the default application first.
- Open the attachment with the selected application through a Main-owned, platform-specific adapter.
- Show native application icons where available and a generic application icon otherwise.
- Always provide a platform-appropriate reveal action: Finder on macOS, File Explorer on Windows, and the file manager on Linux.
- Keep all local attachment resolution and authorization within the existing session-scoped attachment access boundary.
- Route all new user-visible text through the four supported chat locales.

## Non-Goals

- Adding the menu to user attachments, remote URLs, unavailable attachments, or attachments whose current primary action is `Open <filename>`.
- Adding Linux application discovery or application-specific opening.
- Changing which formats ClawX can preview.
- Letting the Renderer receive or execute application paths, command templates, or canonical attachment paths.
- Persisting application associations or letting users change the operating system default application.
- Adding download, export, or copy actions to the menu.

## User Experience

### Eligibility

The secondary action is rendered only when all of the following are true:

- The attachment tone is `assistant`.
- Attachment access is available.
- The access target is local.
- `attachmentOpenMode(...)` returns `preview`.

The action is not rendered for user attachments, pending or unavailable attachments, remote targets, or system-open-only attachments. This keeps the feature aligned with the existing `aria-label="Preview <filename>"` card identified by the requirement.

### In-Card Control Structure

The current attachment button becomes one visual card container with two sibling controls:

- The primary button occupies the file information area. It retains the translated `Preview <filename>` accessible name and its existing click, Enter, and Space behavior.
- The compact secondary button sits inside the card's right edge, displays the translated `Open with` label and a downward chevron, and has an accessible name equivalent to `Open <filename> with`.

The controls must not be nested buttons. The secondary button is inset and independently rounded without a full-height separator, so the attachment remains one visual card rather than a segmented control. Activating the secondary button or any menu item must not bubble into the primary action. Focus rings, hover states, disabled states, rounded card edges, and borders use the existing semantic tokens and attachment-card visual language.

### Menu Contents

On macOS and Windows, the menu has two sections:

1. Compatible applications returned by the operating system.
2. A separator followed by the platform-specific reveal action.

On Linux, the first section is absent and the menu contains only the reveal action.

Application rows contain a 20-pixel native icon when available and the localized application name. A generic application icon replaces an unavailable, malformed, or unreadable native icon. The default application is first. Remaining applications are sorted by localized display name using the current UI locale. Duplicate native handlers are removed by stable platform handler identity.

The application section is not truncated. The menu has a maximum height and scrolls when necessary. Discovery starts lazily when the menu first opens. A localized, disabled loading row is shown while discovery is pending, but the reveal action is immediately available.

If discovery returns no applications, times out, emits malformed output, or otherwise fails, the failure is silent: the application section and loading row disappear, no error toast or failure row is shown, and the reveal action remains available. Failure to resolve one application or icon only omits that application or uses the generic icon; it does not discard other valid applications.

The menu uses Radix Dropdown Menu behavior for arrow-key navigation, Enter activation, Escape dismissal, outside-click dismissal, and focus restoration to the trigger.

### Actions And Errors

- Selecting an application closes the menu and requests an application-specific open from Main.
- Selecting reveal closes the menu and requests an attachment-scoped reveal from Main.
- Discovery and icon-enrichment failures are silent.
- A failure after the user explicitly selects an application, such as the application being removed between discovery and activation, may show the translated existing-style open failure toast.
- A reveal failure may show a translated reveal failure toast.
- No secondary-action failure changes or disables the primary preview action.

## Host API Contract

The new operations belong to the existing `files` host service rather than the generic `shell` service because each operation starts from an untrusted, session-scoped `AttachmentSourceRef`.

The shared contract adds these serializable types:

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

The `files` service adds:

```ts
listAttachmentOpenHandlers(ref: AttachmentFileRef): Promise<AttachmentOpenHandlersResult>;
openAttachmentWith(payload: OpenAttachmentWithPayload): Promise<OpenAttachmentResult>;
revealAttachment(ref: AttachmentFileRef): Promise<OpenAttachmentResult>;
```

`hostApi.files` exposes matching typed facade methods. The Renderer receives only a stable handler identity, display name, bounded icon data URL, and default flag. It never receives a native executable path, bundle path, command line, icon source path, or canonical attachment path.

Linux `listAttachmentOpenHandlers` returns `{ ok: true, platform: 'linux', handlers: [] }`, allowing the Renderer to use one menu model without treating the intentionally unsupported discovery path as an error.

## Main-Process Architecture

### Attachment Access Integration

The existing `AttachmentAccess` service gains corresponding list, open-with, and reveal methods. Every method performs these checks independently:

1. Validate the attachment reference syntax and active session key/generation.
2. Resolve the reference using the Main-owned execution context.
3. Require an existing regular local file.
4. Revalidate the session generation immediately before the operating system action.

Application listing does not grant a durable capability to the file. `openAttachmentWith` resolves the attachment again and performs a fresh, uncached operating-system enumeration to verify that `handlerId` is still registered for that file association immediately before invoking it. Remote targets, stale sessions, invalid references, directories, unsafe schemes, and unavailable files return existing attachment access errors.

`revealAttachment` resolves the canonical local path inside Main and passes it to Electron's `shell.showItemInFolder()`. The Renderer does not route the attachment's display path through `hostApi.shell`.

### Platform Adapter Interface

Main owns an internal adapter with this conceptual interface:

```ts
type NativeOpenHandler = {
  id: string;
  name: string;
  applicationPath?: string;
  iconSourcePath?: string;
  iconDataUrl?: string;
  isDefault: boolean;
};

type AttachmentOpenWithAdapter = {
  list(filePath: string): Promise<NativeOpenHandler[]>;
  open(filePath: string, handlerId: string): Promise<void>;
};
```

Native paths remain private to Main. Platform output is schema-validated and length-bounded before use. Handler display names are limited to 256 UTF-16 code units, identifiers to 512, and native paths to 4,096; values containing control characters or exceeding those limits are rejected. Child processes run with an explicit executable and argument array, `shell: false`, a five-second timeout, a one-megabyte output buffer, and no user-provided environment additions.

### macOS Adapter

The macOS adapter invokes `/usr/bin/osascript -l JavaScript` without a shell. Its JXA bridge imports AppKit/Foundation and uses `NSWorkspace` and Launch Services to:

- Convert the canonical file path to a file URL.
- Enumerate application URLs registered to open that URL.
- Resolve the default application URL.
- Return each application's bundle identifier, localized display name, bundle path, and, for list queries, a 32-point PNG icon encoded as base64.

The adapter deduplicates by bundle identifier. A selected handler is rechecked against a fresh enumeration, then opened with the system `open` tool targeting the Main-owned application bundle path returned by that fresh enumeration. The bundle identifier is the public `handlerId`; the bundle path is never sent to Renderer.

For list queries, the same JXA bridge uses `NSWorkspace.iconForFile()` and AppKit to render each application icon into a 32-point PNG. Main validates the base64 form, PNG signature, and 64 KiB data-URL limit before exposing it to Renderer. Fresh action-time enumeration omits icon work. Icon read, conversion, validation, or size-limit errors are caught per application and produce no discovery error; macOS does not fall back to Electron's generic bundle icon.

### Windows Adapter

The Windows adapter invokes a bundled PowerShell/C# bridge in non-interactive mode without a command shell. The bridge uses documented Windows Shell association APIs, including `SHAssocEnumHandlers` and `IAssocHandler`, to:

- Enumerate handlers registered for the file extension or association.
- Read stable handler identity and localized UI name.
- Determine the current default association.
- Invoke the selected handler for the canonical file through the Shell association API.

The bridge source is maintained with the application and included in packaged Windows resources. The Node adapter passes data as positional arguments rather than interpolating it into PowerShell source. Before invocation, Main verifies the selected handler against a fresh, uncached enumeration.

The adapter obtains an icon source from the handler when available and asks Electron `app.getFileIcon()` for a normal-sized icon. The converted PNG data URL uses the same 64 KiB limit as macOS. Handlers such as some packaged/UWP applications may not expose a usable icon path; those entries remain valid and use the generic Renderer icon.

### Linux Adapter

Linux has no application-discovery adapter in this scope. The list operation returns an empty successful list, application-specific open is unsupported, and attachment-scoped reveal continues to use `shell.showItemInFolder()`.

### Normalization And Caching

Main normalizes valid native results before returning them:

- Remove duplicate handler identities.
- Ensure the default handler is present when the default-association API returns one.
- Put the default handler first.
- Leave locale-aware sorting of remaining display names to Renderer, which knows the active UI locale.
- Convert successful icons to bounded PNG data URLs and omit failed icons.

Handler metadata and converted icons used to render lists are cached in memory for five minutes by platform and file-association key. Attachment authorization is never cached. Every list and action request still resolves the attachment reference. An expired list cache triggers rediscovery. `openAttachmentWith` never trusts the list cache for action-time handler validation: it performs a fresh lightweight enumeration without icon enrichment before opening. Discovery failure is not cached as a user-visible error and does not affect preview or reveal.

## Renderer Architecture

`AcpAttachmentPart` keeps ownership of eligibility and the primary preview action. The in-card secondary control and menu behavior can be extracted into a small attachment-specific component if needed for readability, but it is not generalized to unrelated cards.

When the eligible menu opens:

1. Set a local loading state only for the application section.
2. Call `hostApi.files.listAttachmentOpenHandlers(ref)` on macOS and Windows.
3. Retain valid handler rows and silently convert a failed result or thrown error to an empty list.
4. Sort non-default rows with `Intl.Collator(i18n.language)`.
5. Keep the reveal item available throughout the request.

The component requests discovery each time a previously closed menu opens. Main's five-minute cache makes repeat opens inexpensive while allowing newly installed or removed applications to appear after cache expiry. Component unmount or a newer request invalidates older asynchronous results so another attachment's response cannot populate the menu.

Application icons are rendered from Main-provided data URLs only after checking the expected image data URL prefix. Missing or rejected values render the generic icon. Renderer parsing and image load failures remain local and silent.

## Internationalization

New keys are added under `chat.acp.attachment` in English, Chinese, Japanese, and Russian for:

- Open with.
- Open a named file with another application.
- Searching for compatible applications.
- Show in Finder.
- Show in File Explorer.
- Show in file manager.
- Could not open with the selected application.
- Could not reveal the attachment.

Application names come from the operating system and are not translated by ClawX. No platform-specific display string is hardcoded in React components.

## Security And Privacy

- All three operations use `AttachmentFileRef` and the existing Main-owned session/generation authority.
- The Renderer cannot submit a raw local path for discovery, opening, or reveal.
- The Renderer cannot submit an executable path or command. Main accepts only a handler identity that it can verify against the operating system's current association list.
- Native helper output is untrusted and schema-validated.
- Child process invocation uses no shell or source interpolation.
- Logs and traces must not record canonical file paths, application paths, command lines, or icon data. If open-with tracing is added, it uses the existing opaque attachment identity and bounded event fields.
- Icons are bounded before IPC transfer. Malformed or oversized image output is discarded and replaced by the generic icon.
- Discovery remains user-initiated by opening the menu; it does not scan applications in the background.

## Failure Semantics

Failure isolation is a core acceptance requirement:

- A platform helper startup, timeout, output, parsing, schema, association, application metadata, or icon error must not reject rendering the attachment card.
- Discovery errors produce an empty application section with no error toast, banner, or failure row.
- One invalid application does not remove other valid applications.
- One invalid icon degrades only that row to the generic icon.
- Reveal remains available when discovery fails.
- The primary preview remains available when any secondary action or menu state fails.
- Only a failed action explicitly requested by selecting an application or reveal item may surface a concise localized toast.

## Testing Strategy

### Unit Tests

- Platform-neutral normalization tests cover deduplication, default-first ordering, malformed records, Unicode names, control-character rejection, icon bounds, and per-entry degradation.
- macOS adapter tests mock JXA output and process execution for multiple apps, default association, spaces and Unicode in paths, timeout, malformed output, missing bundle IDs, and icon failures.
- Windows adapter tests mock bridge output and execution for desktop and packaged handlers, default association, spaces and Unicode in paths, timeout, malformed output, handler invocation, and icon fallback.
- Attachment access tests verify local-file requirements, stale session rejection, remote rejection, re-resolution before action, forged handler rejection, handler removal, and attachment-scoped reveal.
- Host contract and facade tests verify the three typed `files` operations and ensure no legacy IPC path is added.
- React tests verify exact eligibility, unchanged primary `Preview <filename>` behavior, the compact in-card sibling control, no click propagation, loading state, application sorting, icon fallback, silent empty/error states, platform reveal labels, and keyboard menu behavior.

### Electron E2E

Extend `tests/e2e/chat-acp-attachments.spec.ts` and its host fixture to cover:

- An eligible assistant local preview card displays the secondary action.
- User, remote, unavailable, and system-open-only cards do not display it.
- Opening the menu requests handler discovery and renders mocked applications with the default first.
- Selecting an application invokes `files.openAttachmentWith` with the attachment ref and handler identity without invoking the preview action.
- Selecting reveal invokes `files.revealAttachment`.
- Clicking the primary card area still opens the current artifact preview and does not call either new action.
- A failed discovery leaves only the reveal item and emits no failure UI.
- Linux renders only the reveal item.

### Project Validation

Because this is a user-visible host communication change, implementation must add or update a task spec that references `gateway-backend-communication`, update the attachment safety and UI/i18n harness coverage where needed, and run the selected harness validation before implementation review. Relevant unit tests, type checking, lint checking, Vite build, focused Electron E2E, communication replay/compare, and harness checks are required. `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` must be reviewed and updated if their documented attachment behavior would otherwise become inaccurate.

## Acceptance Criteria

- Eligible AI local preview cards keep one visual card with a compact inset `Open with` button and semantically separate sibling controls.
- Clicking anywhere in the primary card area preserves the existing preview behavior.
- Clicking the secondary control never opens the preview.
- macOS and Windows show all valid compatible applications reported by their system association APIs, with the default first and remaining entries locale-sorted.
- Application rows use native icons when available and a generic icon for every icon failure mode.
- macOS uses the selected registered application, and Windows invokes the selected Shell handler.
- The menu always ends with the correct Finder, File Explorer, or generic file-manager reveal action.
- Linux shows only the reveal action.
- Discovery and metadata failures are silent, reveal remains usable, and preview remains unaffected.
- Main revalidates the attachment ref immediately before either opening or revealing, and freshly revalidates the selected handler immediately before application-specific opening.
- No executable path, command template, application path, or canonical attachment path crosses into Renderer.
- All new display text is translated in English, Chinese, Japanese, and Russian.
- Unit and Electron E2E coverage demonstrates the in-card interaction, platform behavior, failure isolation, and attachment access safety.

## Alternatives Considered

### Native N-API Addon

A custom native addon could call AppKit/Launch Services and Windows Shell APIs directly with the highest fidelity. It was rejected because it adds architecture-specific compilation, code signing, packaging, and release maintenance disproportionate to this feature.

### Registry And Application-Directory Parsing

Parsing macOS application directories and Windows registry command strings would require less native bridging. It was rejected because it can miss packaged applications, report applications that cannot actually open the file, and introduces unsafe Windows command-template parsing.

### System Open-With Dialog Only

Delegating entirely to the operating system chooser would be simpler and robust. It was rejected because it does not provide the requested in-card dropdown with discovered applications and native icons.
