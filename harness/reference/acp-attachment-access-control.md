# ACP Attachment Access Control And Open With

Status: authoritative durable architecture and security reference, reviewed 2026-07-23.

Related scenarios: `acp-chat-experience`, `acp-file-activity`, `gateway-backend-communication`

Related rules: `attachment-access-safety`, `session-workspace-authority`, `tool-derived-file-safety`, `renderer-main-boundary`, `backend-communication-boundary`

Related tasks: `acp-media-attachments`, `acp-attachment-open-with`, `unify-acp-file-cards`

## Trust Boundaries And Ownership

Renderer owns attachment parsing, timeline projection, presentation, and click routing. Electron Main owns ACP session and relative-path context, filesystem and URI validation, scoped reads, operating-system handler discovery, and native open/reveal actions. Renderer-provided URIs, metadata, staging ids, transcript message ids, attachment references, and selected handler ids are untrusted inputs.

An attachment source reference conceptually identifies the active ACP session key, generation, original URI, and optional Main-issued staging or transcript evidence. A resolved local or remote reference repeats that routing identity. These references, Renderer-visible attachment ids, opaque file identities, and handler ids are not bearer capabilities. This Harness reference is authoritative for the durable architecture and security invariants; `shared/host-api/contract.ts` and `src/lib/acp/timeline-types.ts` define the exact current serializable fields, result unions, error values, and operation signatures.

Renderer reaches attachment operations only through `src/lib/host-api.ts` and the typed Host API. The Main-owned `files` service exposes resolution, bounded text and binary reads, click-initiated open, compatible-handler listing, selected-handler open, and reveal. A successful resolution supplies display metadata, a non-sensitive opaque identity, and an attachment-scoped target, but it does not authorize a later read, list, open, or reveal.

The attachment Open With contract consists of `listAttachmentOpenHandlers(ref)`, `openAttachmentWith({ ref, handlerId })`, and `revealAttachment(ref)`. Renderer receives only platform, stable public handler identity, bounded display name, optional bounded PNG icon data URL, and default status. Main accepts no Renderer-provided canonical file path, executable or application path, association input, bundle path, icon-source path, command line, command template, helper source, or child-process environment addition.

## Grant Lifecycle

ACP session load or creation is the only operation that establishes attachment session and relative-path context. Main canonicalizes the selected workspace root and execution cwd, verifies that both are directories and cwd is contained by the workspace, and commits the context only after the ACP operation succeeds. A failed load restores the prior ACP state and prior context. Switching the active session or advancing generation replaces that context.

Every attachment operation looks up the one active Main-owned context by exact session key and generation. Attachment, preview, list, selected-handler open, and reveal payloads cannot provide or replace the execution cwd. Each operation independently resolves the original ref and checks the active session and generation. Generation is a revocation and race token used together with session identity; it is not a globally monotonic credential.

Listing never grants a durable capability. Application-specific open freshly enumerates current handlers without icons, verifies exact membership of the submitted public handler id, then calls an attachment-owned revalidation callback. That callback resolves the original ref again, requires an existing regular local file, and rechecks generation immediately before native invocation. The action is rejected if the association key changed. Reveal likewise re-resolves and revalidates immediately before `shell.showItemInFolder()`.

## Local Resolution And Special Scopes

An accepted absolute, home-relative, `file:`, or execution-cwd-relative reference may resolve to any existing regular local file, including a file outside the active workspace or managed OpenClaw directories. The target is canonicalized before use. The local `scope` returned to Renderer is classification metadata for existing UI behavior, not an authorization root:

- `workspace`: the canonical target is inside the active ACP workspace root. Relative references resolve from the registered execution cwd.
- `openclaw-media`: the canonical target is outside the workspace. This legacy scope name does not imply containment under an OpenClaw media root.
- `staging`: when a staging id is supplied, it must match the exact canonical file in the Main-owned staging record. The same file may also resolve from an explicit path without claiming staging identity.
- `remote`: a normalized HTTP or HTTPS URL without embedded credentials. Remote references remain session/generation scoped and are revalidated immediately before external open.

Gateway outgoing media remains a record-bound special case, not a general local URL alias. Main validates the outgoing attachment id, requires the URL session key and managed record `sessionKey` to equal the active ACP session key, requires the record attachment id to match, and resolves the record's original file through a managed media root. If both transcript evidence and the record carry a message id, they must agree. The literal `global` session key follows exact equality and is never a wildcard.

## Path And URI Hardening

Main applies syntax checks before ownership checks and authorization again before each side effect. Current defenses include:

- Reject empty, NUL-containing, traversal-bearing, unknown-scheme, UNC, network-share, and overlong source references. The source-reference bound is 4096 characters.
- Decode percent-encoded input once through platform URL handling, then reject encoded traversal or NUL content as well.
- Accept `file:` URLs only with an empty authority or local `localhost` authority; reject remote authorities and credentials.
- Accept only HTTP and HTTPS remote URLs, require a host, reject credentials, and use platform URL normalization for identity and open.
- Resolve home-relative, absolute, Windows-drive, and execution-cwd-relative local references without treating a Renderer-provided path as an authorization root.
- Require an existing regular file and canonicalize the target. Symlink targets and files outside the workspace are allowed after canonical resolution.

Scoped reads open the canonical file without following a final symlink where the platform supports it, verify that the handle is a regular file, recheck the active generation, and read through that handle. Local system open re-resolves immediately before `shell.openPath`; remote open revalidates the normalized URL and active generation before `shell.openExternal`. A prior resolve, handler list, cache entry, or stable identity alone never authorizes a later side effect.

## Opaque Identity And Safe Labels

After authorization, Main returns an opaque hash derived from the canonical local target or normalized remote URL. Renderer uses that value for turn-scoped deduplication and diagnostics, but it must not expose a sensitive host path or be treated as access authority.

Display labels come from approved metadata or a decoded basename. Main reduces labels to a basename, removes control and bidirectional-formatting characters, collapses whitespace to one line, applies the current length bound, and falls back to a generic attachment label. Available attachment cards separately show the decoded local path or normalized remote URL represented by the explicit source reference; unavailable cards remain basename-only. Main-owned staging metadata may provide the original user-selected display path.

## Preview And Shared File Card

The shared Renderer classifier in `src/lib/file-preview-capabilities.ts` decides whether a session-valid local attachment fits an existing inline viewer and its size cap. Supported text/code, HTML, CSV, image, PDF, spreadsheet, and supported Office targets use the right-side Preview panel. Unsupported, known binary, audio/video, archive, other office-document, or over-limit local targets use the system application only after a user click. HTTP and HTTPS targets open externally only after a user click.

Every attachment preview carries an attachment-scoped file reference. Preview components and rich viewers use the attachment text or binary read operations and must not fall back to a naked path or general workspace read. Attachment previews omit trusted workspace-browser reveal or folder actions.

The later shared-card implementation supersedes the original attachment-local card/menu ownership. `src/pages/Chat/AcpFileCard.tsx` now owns the common `AcpFileCard` shell and target-aware `AcpFileOpenWith` menu for distinct `attachment` and `workspace` references. This sharing is presentation only: attachment authorization remains session/generation scoped, while tool-derived file activity uses independently validated workspace-scoped operations. The two reference types must never be converted into each other. Eligible local HTML menus put an action first that submits the already-present local file URI to the existing right-side Web Browser, equivalent to the user entering that URI in its address bar; this browser navigation is separate from native attachment operations.

For attachments, Open With is eligible only when tone is `assistant`, access is `available`, the target is `local`, and `attachmentOpenMode(...)` is `preview`. User, pending, unavailable, remote, and system-open-only attachments do not show it. The primary sibling button retains the translated `Preview <filename>` accessible name and preview behavior. The compact secondary sibling is never nested inside the primary button and must not activate preview.

Created and modified ACP file-activity rows may use the same shared menu with `WorkspaceFileRef`; deleted rows never do. Their Preview and Changes actions remain separate from Open With. Workspace operations follow the authority in `harness/reference/openclaw-file-activity.md`, not attachment grants.

## Lazy Menu Lifecycle

Discovery is user-initiated and starts only when an eligible menu opens. On every closed-to-open transition, the shared component clears old rows and starts a new request on macOS or Windows. A disabled localized loading row occupies only the application section; reveal is immediately available. Linux skips the discovery call. Closing, unmounting, changing target, or starting a newer request invalidates prior asynchronous results so a stale response cannot populate another file's menu.

Valid rows put enumerated defaults first and locale-sort the remainder with `Intl.Collator(i18n.language)`. Rows use the Main-provided 20-pixel PNG icon only after Renderer validates the expected bounded data URL shape; missing, malformed, oversized, or image-load-failed icons use the generic application icon. The application section is not truncated; the bounded-height Radix menu scrolls and retains keyboard navigation, Enter activation, Escape/outside-click dismissal, and trigger focus restoration. Reveal is the final item and is labeled for Finder on macOS, File Explorer on Windows, or the file manager on Linux.

Discovery is requested again on a later open. Main's cache may satisfy that request, but Renderer owns no authorization or native metadata cache. Only a failed user-selected application open or reveal may show a localized non-blocking toast.

## Native Helper Bounds

Native helper output is untrusted and every record is independently schema-validated. The following limits are security invariants in both the Main adapter and static Windows helper where applicable:

- Handler display name: at most 256 UTF-16 code units.
- Private native handler identity/public input: at most 512 UTF-16 code units before platform-specific public-id validation.
- Native file, bundle, executable, and icon-source path: at most 4096 UTF-16 code units.
- Icon PNG data URL: at most 64 KiB, with macOS base64 syntax and PNG signature validation before IPC.
- Process lifetime: five seconds for non-interactive discovery and the interactive Windows protocol.
- Aggregate or `execFile` output: at most 1 MiB.
- Windows stdin protocol: exactly one JSON line no longer than 8192 characters after ready.
- Presentation cache: five minutes and at most 128 association entries.

Control characters invalidate bounded names, ids, and paths. Helpers run through explicit executables and positional argument arrays with `shell: false`, hidden Windows process UI, and a minimal allowlisted Main-owned environment. Payloads, dependencies, Renderer inputs, and inherited arbitrary variables cannot add environment entries. Process failures are reduced to bounded reason codes; command arguments, private output, and native errors are not logged.

## macOS Static JXA Adapter

macOS uses `/usr/bin/osascript -l JavaScript` with a static JXA program owned in `electron/services/attachment-open-with.ts`. File paths and the icon mode are positional arguments after `--`; no Renderer or file value is interpolated into source. The program imports Foundation and AppKit and uses `NSWorkspace`/Launch Services to convert the Main-owned canonical path to a file URL, enumerate registered application URLs, and identify the default application URL.

Each valid enumerated row carries a private bundle identifier, localized display name, and bundle path. The public `handlerId` is the bundle identifier, but bundle and icon-source paths remain private to Main. Listing renders each bundle's `NSWorkspace.iconForFile()` image as a 32-point PNG in JXA; one icon failure omits only that icon, and macOS does not use Electron bundle-icon fallback.

Opening performs a fresh icon-free JXA enumeration, matches the submitted bundle identifier, calls attachment revalidation, rejects an association-key change, then invokes `/usr/bin/open` with `['-a', freshBundlePath, revalidatedPath]`. No caller can select an arbitrary application path.

## Windows Static PowerShell/C#/COM Adapter

Windows uses the checked-in static bundled `resources/scripts/attachment-open-with.ps1` helper. Development resolves it from the app resources tree and packaged builds resolve the copied resource under `process.resourcesPath`; Windows CI/native smoke and release packaging checks protect source validity and packaged-resource identity. Main starts `powershell.exe` with `-NoLogo`, `-NoProfile`, `-NonInteractive`, `-ExecutionPolicy Bypass`, `-File`, helper path, mode, and data as separate arguments. It never builds or executes PowerShell/registry command templates.

The helper's static embedded C# uses documented Shell APIs: `SHAssocEnumHandlers`, `AssocQueryString`, `IAssocHandler`, `IEnumAssocHandlers`, `IShellItem`, and Shell data-object binding. Listing derives the association from the Main-owned path, enumerates desktop and packaged handlers, reads localized UI names and icon/executable metadata when available, and marks an enumerated row default only when strict normalized executable identity matches `AssocQueryString`. Main requests Windows icons from validated private icon/executable paths through `app.getFileIcon()`; icon absence or failure does not invalidate a handler.

Windows never exposes native handler identity. Both Node and the helper derive the public opaque id as lower-case hex `SHA-256(UTF8("win32\0" + nativeIdentity))`; action input must be exactly 64 lower-case hexadecimal characters. Private identity-to-public-id relationships stay inside Main/helper memory and list cache records.

For action-time validation, Main spawns `prepare-open` with the initial pre-authorized canonical path and opaque id as separate arguments. The helper derives that path's association, enumerates exactly once, recomputes ids, retains only the matching `IAssocHandler` COM object, emits exactly one `{"ready":true}` line, and waits. Only after ready does Main re-resolve the original attachment ref and generation. If revalidation succeeds and the association key is unchanged, Main sends exactly one bounded line containing only `{ "command": "invoke", "path": <post-ready canonical path> }`. The helper rechecks the association, creates a Shell data object for that path, invokes the retained handler, and releases COM objects. Timeout, output overflow, EOF, malformed/repeated protocol, cancellation, revalidation failure, stdin failure, association change, or non-zero helper exit prevents invocation.

## Successful Empty Result On Linux

Linux intentionally has no application discovery or application-specific open in this scope. `listAttachmentOpenHandlers` still authorizes and resolves the attachment, then returns `{ ok: true, platform: 'linux', handlers: [] }` without starting a helper. The shared menu therefore contains only attachment-scoped reveal. Application-specific open is unsupported rather than falling back to a default application.

## Normalization And Presentation Cache

Main validates rows independently, removes duplicate public identities, carries a default flag across duplicates, and keeps valid enumerated default rows before other operating-system rows. Renderer locale-sorts non-default rows. Current code normalizes only rows returned by enumeration; it does not synthesize a handler that a separate default-association query names but enumeration omitted.

The durable guarded requirement is that any future default-handler insertion must use complete validated metadata from a platform API, preserve exact fresh-membership and invocation checks, and remain representable without exposing private identity or paths. It is a follow-up, not implemented behavior. Tests and documentation must not claim insertion until the adapter actually supplies and validates that row.

Main caches normalized list metadata, converted icons, and private list records for five minutes by platform plus lower-case file-association key; extensionless files use the lower-case basename. Expired entries are pruned, growth is bounded to 128 entries, and oldest entries are evicted. This discovery cache is presentation-only. Attachment authorization is never cached, failures grant nothing, and action-time validation always uses a fresh icon-free enumeration rather than the cache.

## Failure And Privacy Semantics

An invalid, stale, missing, unsafe, remote-for-local-operation, or non-file reference becomes an unavailable/error result. It cannot be previewed or opened, but it does not suppress assistant prose or independently valid attachments. A valid existing file does not become unavailable merely because it is outside the workspace. Read failures remain inside Preview; local or remote open failures use the localized non-blocking Chat error path.

Helper startup, timeout, output, parsing, schema, association, application metadata, and icon failures must not reject attachment-card rendering. Whole discovery failure becomes an empty application section with no toast, banner, or failure row. One invalid handler is omitted; one invalid icon affects only that row. Reveal remains available and primary preview remains unchanged. Only a failed action explicitly requested by selecting an application or reveal may surface a concise localized toast.

Logs and traces must not contain transcript bodies, file content, credentials, canonical file paths, application or bundle paths, icon-source paths, native handler identities, helper source/output, command lines, or icon data. Optional open-with tracing may use only the existing opaque attachment identity and bounded allowlisted fields such as source kind or reason code.

## Non-Goals

- Application discovery or application-specific open on Linux.
- Open With on user, remote, unavailable, pending, system-open-only, or non-preview attachment cards.
- Changing preview format classification or file-size limits.
- Persisting associations or changing an operating-system default.
- Download, export, copy, or system chooser actions in this menu.
- Renderer access to canonical/native paths, private identities, helper source, or command templates.
- Converting workspace file-activity evidence into attachment authority.
- Generalizing the card/menu beyond ACP attachment and file-activity surfaces.

## Rejected Alternatives

### Native N-API Addon

A native addon could call AppKit, Launch Services, and Windows Shell APIs directly. It was rejected because architecture-specific compilation, signing, packaging, and release maintenance are disproportionate to this feature.

### Registry Or Application-Directory Parsing

Scanning macOS application directories or parsing Windows Registry command strings was rejected because it misses packaged applications, can report handlers that cannot open the file, and introduces unsafe command-template parsing. Windows must use Shell association COM APIs.

### System Open-With Dialog Only

Delegating entirely to the operating-system chooser was rejected because it does not provide the required in-card application list, icons, and independently available reveal action.

### Renderer-Owned Discovery Or Paths

Renderer-side helper execution, raw executable selection, and generic-shell reveal were rejected because they bypass attachment-scoped authorization, expose private host paths, and make stale-session revocation unenforceable.

## Validation Anchors

- `tests/unit/attachment-open-with.test.ts`: schema normalization, 256/512/4096 bounds, control rejection, SHA-256 opacity, stable deduplication/default-first ordering, five-minute/128-entry cache, 64 KiB icons, static JXA arguments, shell-free sanitized process options, five seconds/1 MiB bounds, Linux no-process behavior, fresh macOS membership, and Windows ready/revalidate/invoke protocol.
- `tests/unit/attachment-open-with-native.test.ts`: real platform-gated static JXA and PowerShell/C#/COM smoke coverage plus packaged helper resolution.
- `tests/unit/attachment-access.test.ts`: typed per-operation attachment authorization, stale generation and remote rejection, action-time re-resolution, forged handler rejection, association-race prevention, scoped reveal, and sensitive diagnostic exclusion.
- `tests/unit/files-api-workspace.test.ts`: the distinct workspace-scoped operations consumed by the later shared `AcpFileCard` implementation.
- `tests/unit/host-api-facade.test.ts` and `tests/unit/host-services.test.ts`: typed `files` facade/service routes and absence of a legacy direct IPC path.
- `tests/unit/acp-chat-components.test.tsx`: exact attachment and file-activity eligibility, sibling controls, lazy loading, stale-request invalidation, locale ordering, icon fallback, silent discovery failure, platform reveal labels, explicit-action errors, and keyboard menu behavior.
- `tests/unit/artifact-panel.test.tsx`, `tests/unit/file-preview-body.test.tsx`, and `tests/unit/rich-file-viewers.test.tsx`: unchanged attachment-scoped preview behavior.
- `tests/e2e/chat-acp-attachments.spec.ts`: attachment card click routing, typed list/open/reveal requests, platform branches, Linux reveal-only behavior, and failure isolation.
- `tests/e2e/chat-file-changes.spec.ts`: later `AcpFileCard` workspace-target reuse and deleted-row exclusion without conflating workspace and attachment grants.
- `.github/workflows/check.yml` and `.github/workflows/release.yml`: Windows native bridge execution and packaged helper presence/hash checks.
