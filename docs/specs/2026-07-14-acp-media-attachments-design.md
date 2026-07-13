# ACP Media Attachments Design

Status: approved design

Date: 2026-07-14

## Summary

ClawX will render file attachments in ACP Chat through one attachment model and one UI component.

The preferred path is standard ACP content:

- `resource_link`
- `resource` with a URI

OpenClaw does not currently project assistant media from Gateway chat events into ACP resource content. It projects only assistant text and thought content, while Gateway processing removes `MEDIA:` directives from the visible assistant text. ClawX will therefore add a bounded OpenClaw transcript compatibility supplement for explicit assistant `MEDIA:` directives.

The compatibility supplement is an exception, not a second Chat history authority. It must remain visibly marked in types, diagnostics, comments, and architecture documentation so it can be removed when the distributed OpenClaw ACP adapter emits standard resource blocks.

ClawX does not modify OpenClaw. The implementation must work with the distributed OpenClaw package.

## Context

The ACP Chat architecture introduced by commit `ff9024f` renders the Chat detail page from:

```text
Chat UI
  -> ACP session store
  -> typed host API
  -> Electron Main AcpChatService
  -> openclaw acp
  -> ACP session/update
  -> Renderer ACP reducer
  -> ACP timeline
  -> React
```

The legacy `src/stores/chat/helpers.ts` attachment extraction and `ChatMessage` renderer are not part of this primary detail-page path. Reconnecting them would restore two competing history and rendering systems and is not acceptable.

ACP supports `resource_link` and embedded `resource` content blocks inside `agent_message_chunk`. The existing Renderer already converts these blocks to a static file render part, but the card has no preview or open behavior.

The distributed OpenClaw ACP adapter currently handles assistant Gateway snapshots by extracting only `thinking` and `text` blocks. It does not emit resource blocks for Gateway media. Its transcript replay fallback similarly restores only text and thought content. Consequently, the OpenClaw Web UI can show a `MEDIA:` attachment while ClawX receives only the cleaned assistant prose through ACP.

## Goals

- Render standard ACP `resource_link` and URI-backed `resource` blocks as attachments.
- Restore explicit OpenClaw assistant `MEDIA:` attachments that the current OpenClaw ACP adapter omits.
- Cover both a newly completed prompt and loading an existing session.
- Render attachment rows after the message body.
- Open supported local files in the existing right-side Preview panel.
- Open unsupported local files with the operating system default application.
- Open HTTP and HTTPS attachments externally.
- Restrict assistant-produced local references to the active workspace or verified OpenClaw managed media.
- Keep ACP session replay as the primary Chat history authority.
- Preserve session and generation race protections.
- Provide complete English, Chinese, Japanese, and Russian localization.
- Cover the user-visible behavior with Electron Playwright tests.

## Non-Goals

- Modifying OpenClaw source or patching its distributed package.
- Reviving the legacy Chat message renderer or using legacy Chat state as the ACP page data source.
- Treating arbitrary absolute paths in assistant prose as attachments.
- Reconstructing missing tools, plans, permissions, thoughts, or ordinary assistant messages from transcript history.
- Adding inline viewers for DOC, DOCX, PPT, PPTX, archives, audio, or video.
- Adding a dedicated viewer for embedded ACP blob or text resources without a usable URI.
- Persisting a ClawX ACP ledger or synthetic attachment cache.
- Automatically opening a local file without a user click.

## Approved Product Decisions

- Scope is standard ACP resources plus a restricted OpenClaw `MEDIA:` compatibility supplement.
- Assistant local paths are allowed only inside the active workspace or verified OpenClaw managed media roots.
- ClawX-owned attachment staging remains allowed for existing user-selected attachments.
- Unsupported local attachment types open directly in the system default application after the user clicks the card. No second confirmation is required after Main validates the target.
- Attachments render after message prose.
- Transcript compatibility recognizes explicit `MEDIA:` directives only, not bare paths.
- Compatibility covers live completion and historical session load.
- HTTP and HTTPS attachment references render as cards and open externally.

## Architecture

### Preferred Standard ACP Path

```text
ACP agent_message_chunk(resource_link/resource)
  -> contentBlockToRenderPart
  -> pending AttachmentRenderPart(source = acp-resource)
  -> Main attachment resolution
  -> ACP timeline
  -> AcpAttachmentPart
```

The standard path remains protocol-native. It does not query transcript history and does not create synthetic ACP events.

### OpenClaw Compatibility Path

```text
ACP prompt completion or session load
  -> hostApi.sessions.history
  -> explicit MEDIA extractor
  -> transcript turn alignment
  -> Main attachment resolution
  -> synthetic AttachmentRenderPart(source = openclaw-media)
  -> ACP timeline
  -> AcpAttachmentPart
```

The Renderer owns parsing, turn alignment, deduplication, and semantic projection. Main owns transcript retrieval, filesystem authorization, safe reads, and operating-system actions.

Main must not manufacture an `agent_message_chunk` or make a compatibility attachment appear to have come from the ACP agent. The synthetic timeline data must be explicitly marked as compatibility data.

### Mandatory Compatibility Comment

The implementation entry point that reads transcript history for general `MEDIA:` attachments must include a durable code comment with the following meaning:

> OpenClaw ACP currently projects only assistant text/thought content and strips MEDIA directives from the live visible reply. This transcript read is a bounded compatibility fallback for missing resource blocks, not a second Chat history source. Remove it when the distributed OpenClaw ACP adapter emits standard resource_link/resource content for assistant media.

The comment must link to the durable harness reference that documents the exception. A short comment such as "load attachments" is not sufficient.

## Attachment Model

The current `RenderPart` file variant will be replaced by an explicit attachment variant with raw protocol identity and resolved access state:

```ts
type AttachmentRenderPart = {
  kind: 'attachment';
  attachmentId: string;
  reference: {
    uri: string;
    name: string;
    mimeType?: string;
    size?: number;
  };
  source: 'acp-resource' | 'openclaw-media';
  evidenceId?: string;
  access:
    | { status: 'pending' }
    | { status: 'unavailable'; reason: AttachmentUnavailableReason }
    | {
        status: 'available';
        identity: string;
        target: AttachmentAccessTarget;
        mimeType: string;
        size: number;
      };
};

type AttachmentAccessTarget =
  | {
      kind: 'local';
      scope: 'workspace' | 'openclaw-media' | 'staging';
      ref: AttachmentFileRef;
    }
  | { kind: 'remote'; ref: AttachmentRemoteRef; url: string };
```

`AttachmentFileRef` and `AttachmentRemoteRef` contain the active `sessionKey`, `generation`, and original resource reference. They are not bearer tokens and do not grant access by themselves. Main re-resolves and re-authorizes every workspace, managed-media, staging, and remote reference on every read or open operation.

`identity` is an opaque, non-sensitive stable identity returned by Main after authorization. It is derived from a canonical local target, outgoing record identity, or normalized remote URL, but it must not expose a sensitive absolute path to Renderer diagnostics or UI.

Standard ACP mapping preserves the following fields when available:

- `uri`
- `name`, falling back to `title`, then the URI basename
- `mimeType`
- `size`

An embedded ACP `resource` is represented by its required URI. Supporting an inaccessible non-file URI solely from its embedded text or blob is outside this change. Such a resource renders an unavailable attachment card rather than an unsupported-content error.

Compatibility attachments include an `evidenceId`. Native ACP attachments do not require one.

The synthetic timeline marker will distinguish at least:

```ts
type CompatibilitySource = 'image-generation' | 'openclaw-media';
```

The existing image-generation projection remains an inline-image experience. It shares the transcript fetch coordinator and normalized media identity utilities where applicable, but this change does not convert generated images into paperclip cards.

Standard ACP and transcript candidates both enter the same asynchronous attachment resolver. A standard ACP resource is not considered actionable merely because it came from the protocol.

## Standard ACP Conversion

`contentBlockToRenderPart` will map:

- ACP `resource_link` to `AttachmentRenderPart`.
- ACP `resource` with a URI to `AttachmentRenderPart`.
- Existing image blocks to the existing image render part.
- Unsupported blocks to the existing localized error path.

The reducer must preserve attachment metadata instead of discarding ACP `title`, `size`, and MIME information.

For user messages, non-attachment parts render first and attachment parts render afterward within the user group.

For assistant messages, display grouping lifts attachment parts from all message segments into one turn-level attachment list. `AcpAssistantTurn` renders normal timeline items first, then the attachment list, then the existing file-activity summary. Relative ordering among attachments is preserved. This guarantees that an early resource block cannot appear before assistant prose emitted in a later segment after a tool call.

## OpenClaw MEDIA Extraction

The extractor is a pure function over transcript messages and session context.

It accepts only messages whose normalized role is `assistant`.

It recognizes a directive only when the line, after leading whitespace, starts with `MEDIA:`. Parsing must ignore fenced code blocks.

Accepted reference forms are:

- Absolute POSIX paths.
- Windows drive paths.
- `file://` URIs.
- `~/` paths.
- Paths relative to the session execution cwd.
- HTTP URLs.
- HTTPS URLs.

Quoted references can contain spaces. One directive line produces one ordered reference. Multiple directive lines preserve transcript order.

The extractor does not recognize:

- Bare paths in ordinary prose.
- Inline prose such as `Here is the file: MEDIA:/path/file.xlsx`.
- Markdown-wrapped directives.
- Directives inside fenced code blocks.
- Unknown URI schemes.

The raw directive and full host path are never rendered as assistant prose. The card displays only a safe filename label.

## Turn Association

ACP `messageId` is not a durable identifier across live updates, event-ledger replay, and transcript fallback. Transcript attachment association must not depend on equality between ACP and transcript message IDs.

Both data sources will be partitioned into conversation turns using real user-message boundaries:

- A transcript turn begins at a user message and ends before the next user message.
- An ACP turn is derived from the same user and assistant grouping used by the current timeline UI.
- Leading orphan assistant content is not eligible for transcript attachment projection.

User text is normalized before matching. Normalization removes known OpenClaw display metadata such as the working-directory envelope while preserving user-authored content. It must not perform broad fuzzy matching.

Transcript history is a bounded newest-message window, while ACP replay may contain older turns. Alignment therefore proceeds from newest to oldest. Turns are matched by normalized user text and duplicate occurrence order from the tail. This prevents the first repeated prompt in a transcript suffix from attaching to an older equal prompt in the full ACP timeline.

The current live user turn is matched directly by the optimistic message identity and normalized prompt text. Historical alignment never uses a plain forward ordinal offset.

For each aligned transcript turn:

- Collect explicit assistant `MEDIA:` directives in transcript order.
- Store resolved attachments on a marked synthetic attachment segment anchored to the corresponding assistant turn. The display layer lifts it into the turn-level attachment list after prose and process items.
- If the ACP turn has no ordinary assistant message segment, the synthetic attachment segment still belongs to that turn and remains visible.
- If the transcript turn cannot be matched unambiguously, skip it and record a reason-coded diagnostic event. Do not attach it to the nearest turn by guesswork.

For a newly sent prompt, the store already knows the active user message and generation. The live supplement must restrict matching to that current turn.

## Live And Historical Supplement Timing

### Existing Session Load

After a successful `loadSession` for an existing session, ClawX queries at most the latest 1000 transcript messages. The image-generation and general media extractors share the same fetched response instead of making independent history calls. The transcript response is treated as a suffix: reverse alignment either finds an unambiguous user-turn anchor or rejects the candidate.

### Newly Completed Prompt

After `sendAcpPrompt` succeeds:

- Query transcript history once immediately.
- Schedule one bounded follow-up query 1500 milliseconds later to cover OpenClaw asynchronous transcript persistence.
- Deduplicate both results.

The delayed query is intentionally bounded. This design does not add indefinite polling.

### Race Protection

Every asynchronous transcript request, attachment resolution, preview read, and delayed retry must verify:

- Active session key.
- ACP load generation.
- Supplement operation identity.
- For live projection, the active user turn identity.

Switching sessions, starting a new load, or cancellation invalidates prior supplement work. A stale result must not mutate the current timeline.

## Deduplication

Attachment identity uses the opaque normalized identity returned by Main:

- Canonical local path for authorized local files.
- Stable outgoing attachment identity for Gateway/OpenClaw managed media records.
- Normalized URL for HTTP and HTTPS resources.

Deduplication applies within a conversation turn and across:

- Immediate and delayed transcript queries.
- Repeated history loads.
- Standard ACP resources and transcript compatibility evidence.
- Existing image-generation compatibility evidence where both identify the same resource.

If native ACP and compatibility evidence identify the same target, the native ACP attachment wins regardless of arrival order. If compatibility evidence was projected first, resolving a later native resource replaces or removes the compatibility duplicate in the same turn.

Unavailable resolution is not a final delivery reservation. Immediate transcript lookup may create an unavailable card, and the delayed lookup may re-resolve and upgrade that same `attachmentId` to available. Deduplication commits an available identity only after successful resolution.

## Main-Process Attachment Boundary

Renderer-provided attachment references are untrusted. Main will expose typed attachment operations through `src/lib/host-api.ts` and the shared host contract:

```ts
files.resolveAttachment(...)
files.readAttachmentText(...)
files.readAttachmentBinary(...)
files.openAttachment(...)
```

The request types carry `sessionKey`, `generation`, and the original reference. Main obtains workspace authorization from a shared Main-owned ACP session context registry, not from a Renderer-supplied root. A prior successful resolve is not authorization for a later read or open.

`registerTypedHostHandlers` creates one `AcpSessionAccessRegistry` and injects it into both `AcpChatService` and `createFilesApi`. The registry stores:

```ts
type AcpSessionAccessContext = {
  sessionKey: string;
  generation: number;
  workspaceRoot: string;
  executionCwd: string;
};
```

`AcpChatLoadPayload` is extended to carry `workspaceRoot` and `cwd`. The ACP load/new operation is the workspace capability-grant boundary: the workspace feature intentionally lets the user choose a workspace, and Main accepts that choice only at this operation. During `loadSession`, Main canonicalizes both paths, rejects non-directories and traversal, verifies that the execution cwd is inside the workspace root, and registers the context only after the ACP load/new operation succeeds. A failed load restores the prior registry entry together with prior ACP state. `sendPrompt` uses the registered context and rejects a payload whose cwd does not match it. Switching sessions or advancing generation replaces the active registry entry.

After registration, no attachment, preview, or open request can provide or replace a workspace root. Those requests identify only the session, generation, and original attachment reference. Tests for workspace-root spoofing therefore attempt to resolve an outside path through an existing session grant, not to redefine the grant through an attachment request.

Files service operations look up this registry by exact session key and generation. They never accept a Renderer-provided workspace root as authorization.

`resolveAttachment` returns a discriminated result containing:

- Available or unavailable status.
- Workspace, OpenClaw media, staging, or remote target kind.
- Safe display name.
- MIME type and size when known.
- An attachment-scoped file reference for every local target.
- A normalized remote URL when applicable.

Allowed local roots and ownership rules are:

- The canonical active workspace root.
- The exact `<openclaw-state>/media` and `<openclaw-config>/media` subtrees. The parent state/config directories, transcripts, credentials, stores, workspaces, sandboxes, and canvas directories are not attachment roots.
- An external OpenClaw media root only when the same runtime configuration used to launch OpenClaw explicitly declares that media root; no generic parent-directory expansion is allowed.
- Verified outgoing media records under `<openclaw-state>/media/outgoing/records`, subject to the session checks below.
- ClawX staging files referenced by a Main-owned staging id created by `files.stage`. A raw path merely located under the staging parent is insufficient.

The implementation introduces one `resolveOpenClawStateDir` path utility that follows the same environment/runtime configuration used to launch the distributed OpenClaw process, with the existing home-directory location as fallback. Transcript history, outgoing media records, attachment resolution, and existing media preview code use this utility rather than independently hardcoding `~/.openclaw`. Expected changes therefore include `electron/utils/paths.ts`, `electron/services/sessions-api.ts`, and `electron/services/media-api.ts`.

Main validation includes:

- Path expansion and canonicalization.
- Rejection of NUL and traversal input.
- Rejection of unknown URI schemes.
- A maximum source-reference length of 4096 characters.
- Single-pass percent decoding through platform URL APIs, followed by another traversal and NUL check.
- `file:` URLs with an empty authority or local `localhost` authority only; remote file authorities, UNC paths, and network shares are rejected.
- HTTP/HTTPS URLs without embedded credentials; scheme and host are normalized for identity and default ports are removed.
- Regular-file requirement.
- Existence check.
- Symlink and realpath containment checks.
- Safe-open behavior consistent with current workspace file APIs.
- Revalidation immediately before every read or system open.

An outgoing Gateway media URL is allowed only when Main can validate its attachment identifier, verify that the URL session key and record `sessionKey` equal the active ACP session key, read its managed record, and resolve the original file through an allowed OpenClaw media path. When transcript evidence contains a message id and the outgoing record contains a message id, they must also agree. The literal `global` session follows the same exact-equality rule and is not a wildcard.

Display names are derived from ACP metadata or a decoded basename, stripped of control and bidirectional formatting characters, collapsed to one line, and length-bounded before entering the UI.

## Preview And Open Routing

Preview capability will be centralized in an exported classifier shared by the attachment click handler and `FilePreviewBody`. The classifier takes extension, MIME type, known size, and access target. It must not duplicate an independent extension list.

The right-side Preview panel is used for existing supported types, including:

- Images.
- Text, Markdown, and source code.
- HTML.
- PDF.
- XLS and XLSX.
- CSV through its existing text preview behavior.

Unsupported local types, including archives, DOC/DOCX, PPT/PPTX, audio, video, and known binary files, call `files.openAttachment` after the user clicks. Main revalidates the target and delegates to Electron `shell.openPath`.

A file whose type normally supports inline preview but whose resolved size exceeds the existing text or rich-binary preview cap is treated as not previewable for attachment-click routing and opens directly with the system application. It does not first open a guaranteed-too-large Preview state or show the existing second confirmation dialog.

HTTP and HTTPS cards call `files.openAttachment` after a user click. Main revalidates the session, generation, scheme, credentials, and normalized URL, then delegates to `shell.openExternal`. Local files are delegated to `shell.openPath` instead.

All attachment previews, including workspace attachments, add an `attachmentFileRef` variant to `FilePreviewTarget`. `FilePreviewBody` and its rich viewers route reads through `files.readAttachmentText` or `files.readAttachmentBinary` whenever that ref is present. They must not call the general workspace or naked-path read APIs for an attachment. Existing workspace APIs continue to serve the workspace browser and file-activity features.

## UI Design

`AcpFilePart` will be replaced with `AcpAttachmentPart`.

The card follows the visual language of `AcpTurnFileActivity` without representing a file change:

- Full-width row within the assistant content column.
- `Paperclip` icon on the left.
- Single-line truncated filename.
- Optional secondary MIME or size information when useful.
- `bg-surface-modal` or the equivalent established surface token.
- `border-black/10 dark:border-white/10`.
- `hover:bg-black/5 dark:hover:bg-white/5` for actionable cards.
- Standard focus-visible ring.
- Disabled styling and a localized unavailable reason when resolution fails.

The card must not show the absolute host path. The full safe label may be exposed through a tooltip or accessible name.

Multiple attachments render as separate rows in declaration order. Attachment rows render after message prose.

The entire available row is clickable. The component must use a semantic button for local actions rather than a click handler on a non-interactive `div`.

## Error Handling

- Transcript request failure does not turn a successful ACP prompt into an error.
- One malformed or unavailable attachment does not suppress other attachments or assistant prose.
- An unavailable reference renders a disabled attachment row with a localized status.
- Preview read failures use the existing right-panel error presentation.
- System open failures surface a localized non-blocking error.
- Remote URL failures are returned by `files.openAttachment` and use the same localized non-blocking error path as local system-open failures.
- Unsupported embedded resource content with no usable URI remains unavailable and does not crash the reducer.

## Diagnostics

The existing memory-only ACP trace channel will record reason-coded compatibility decisions:

- Transcript request started, succeeded, or failed.
- MEDIA directive accepted or rejected by category.
- Turn matched or unmatched.
- Attachment resolution available or unavailable.
- Projection appended, deduplicated, or dropped as stale.
- System open success or failure.

Trace records may contain counts, source type, session/generation routing data, and hashed identities. They must not contain transcript bodies, file contents, API credentials, or full sensitive absolute paths.

## Components And Expected Change Areas

The implementation is expected to touch these areas:

- `shared/acp-chat/types.ts`
- `shared/host-api/contract.ts`
- `src/lib/acp/content-blocks.ts`
- `src/lib/acp/timeline-types.ts`
- A new focused OpenClaw media compatibility module under `src/lib/acp/`
- `src/lib/acp/reducer.ts` or a focused timeline attachment projection helper
- `src/stores/acp-chat-session.ts`
- `src/pages/Chat/AcpMessageSegment.tsx`
- `src/pages/Chat/AcpAssistantTurn.tsx`
- `src/lib/acp/timeline-groups.ts`
- `src/components/file-preview/build-preview-target.ts`
- `src/components/file-preview/FilePreviewBody.tsx`
- `src/lib/generated-files.ts`
- `electron/services/files-api.ts` and its typed host registration
- `electron/services/media-api.ts`
- `electron/services/sessions-api.ts`
- `electron/utils/paths.ts`
- `shared/i18n/locales/{en,zh,ja,ru}/chat.json`
- Unit, Electron E2E, harness, architecture reference, and README files

The implementation must not add direct Renderer IPC or direct Gateway HTTP calls.

## Testing Strategy

### Pure Unit Tests

MEDIA parser tests cover:

- Absolute and relative local references.
- `file://`, home-relative, Windows, HTTP, and HTTPS references.
- Quoted paths containing spaces.
- Multiple ordered directives.
- Fenced code blocks.
- Inline prose and Markdown wrappers.
- Bare-path rejection.
- Unknown-scheme rejection.

Projection tests cover:

- Live current-turn projection.
- Historical turn alignment.
- Duplicate user text matched by occurrence order.
- A newest-1000 transcript suffix containing a prompt that also occurs before the window.
- Attachment-only assistant turns.
- Unmatched turns rejected without guessing.
- Immediate and delayed query deduplication.
- Native ACP resource preference over compatibility evidence.
- Compatibility-first followed by a late native ACP resource.
- Unavailable-first followed by a successful delayed resolution.
- Session and generation stale-result rejection.
- Attachments emitted before a tool call still displayed after prose emitted in a later segment.

Reducer/content tests cover:

- Standard ACP `resource_link` metadata preservation.
- URI-backed embedded `resource` conversion.
- Body-before-attachment rendering order.
- Unsupported resource behavior.

### Main Tests

Attachment host API tests cover:

- Workspace file allow.
- Renderer-supplied workspace-root spoofing rejection.
- Failed ACP load restores the previous workspace grant.
- Session or generation changes invalidate the previous workspace grant.
- Configured OpenClaw managed media allow.
- Verified outgoing media record allow.
- Cross-session outgoing media record rejection.
- Custom OpenClaw state directory resolution.
- State/config parent-directory rejection and undeclared external media-root rejection.
- ClawX staging file allow.
- Raw staging path without a Main-owned staging id rejection.
- Outside-root rejection.
- Traversal, unknown scheme, directory, missing file, and symlink escape rejection.
- Revalidation for text read, binary read, and system open.
- Remote URL normalization.
- Remote file authorities, encoded traversal, encoded NUL, URL credentials, and hostile display labels.

### Component Tests

UI tests cover:

- Paperclip icon and filename.
- Attachment rows after prose.
- Preview routing for supported files.
- System default application routing for unsupported local files.
- External routing for HTTP and HTTPS.
- Disabled unavailable state.
- Keyboard activation and accessible names.
- Every attachment Preview viewer uses attachment-scoped reads and never falls back to workspace or naked-path reads.

### Electron E2E

An Electron Playwright scenario reproduces the reported flow with a controlled ACP update stream, transcript fixture, and temporary workspace file rather than relying on a provider key or nondeterministic model output:

1. Create a default temporary workspace containing `budget_sample.xlsx`.
2. Feed ACP visible prose plus the corresponding transcript assistant message containing an explicit absolute-path `MEDIA:` directive.
3. Verify the ACP visible reply does not need to contain the raw directive.
4. Verify `budget_sample.xlsx` appears as an attachment after the prose.
5. Click it and verify the right-side Preview panel opens the spreadsheet viewer.
6. Reload or switch away and back, then verify the historical attachment is restored.

Additional E2E cases verify an archive calls the validated system-open host operation and an HTTPS resource calls external open. Tests assert that no legacy Renderer IPC or direct Gateway fetch is introduced.

## Harness And Documentation

Before implementation review, add a task spec under `harness/specs/tasks/` referencing `gateway-backend-communication` because the change crosses Renderer, Main, host-api, ACP, and OpenClaw transcript paths.

Update:

- The ACP Chat scenario.
- The ACP compatibility content-safety rule.
- The generated media/diagnostics architecture reference, generalized to describe the new bounded attachment exception.
- The file safety reference or rule to distinguish explicit user-facing attachments from incidental tool-derived paths.
- `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` if their Chat capability descriptions require synchronization.

The reference documentation must continue to state that transcript supplementation is exceptional and must not expand into ordinary Chat reconstruction.

## Acceptance Criteria

- A standard ACP `resource_link` or URI-backed `resource` renders an actionable paperclip attachment card.
- The reported OpenClaw `MEDIA:/absolute/path/budget_sample.xlsx` flow renders an attachment in ACP Chat even though OpenClaw ACP emits no resource block.
- The raw `MEDIA:` directive is not displayed.
- The attachment renders after assistant prose and preserves declaration order.
- Supported files open in the right-side Preview panel.
- Unsupported authorized local files open with the system default application after a click.
- HTTP and HTTPS attachments open externally after a click.
- Arbitrary prose paths do not become attachments.
- Local references outside the workspace and verified managed roots cannot be previewed or opened.
- Live and historical paths deduplicate and reject stale session/generation results.
- Native ACP resources take precedence over transcript compatibility evidence.
- The implementation contains the required compatibility rationale comment and links it to durable architecture documentation.
- No OpenClaw source or distributed package is modified.
- No legacy Chat renderer, direct Renderer IPC, or direct Gateway HTTP request is introduced.
- Unit, Electron E2E, typecheck, harness, and required communication regression checks pass.

## Alternatives Rejected

### Main Synthesizes ACP Resource Updates

Main could query transcript history and emit fake `agent_message_chunk` resource blocks. This would make Renderer handling superficially uniform, but it would misrepresent compatibility data as agent-provided ACP, conflict with Main's routing-only role, and complicate replay and diagnostics. It is rejected.

### Reuse Legacy Chat Helpers And Renderer

The old helper can extract many raw paths, but the ACP page no longer consumes that message store. Reusing it would create dual history authorities, duplicated rendering, and race conditions. It is rejected.

### Standard ACP Only

Waiting for OpenClaw to emit `resource_link` is architecturally pure but does not solve the current distributed runtime behavior. The bounded supplement is required until upstream support exists.

### Parse Bare Paths

Parsing arbitrary paths from prose offers broad compatibility but creates false positives and expands the local-file trust surface. Only explicit `MEDIA:` directives are accepted for the OpenClaw compatibility path.

## Implementation Scope

This design is one implementation project because standard ACP rendering and OpenClaw compatibility share the attachment model, Main authorization boundary, preview routing, UI, and tests. The implementation plan may stage work internally as contracts and authorization, standard ACP rendering, compatibility projection, and validation, but each stage must converge on the one shared model rather than ship parallel attachment systems.
