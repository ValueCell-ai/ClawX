# ACP Attachment Access Control

Status: current security and ownership reference, reviewed 2026-07-16.

Related scenario: `acp-chat-experience`

Related rules: `attachment-access-safety`, `session-workspace-authority`, `tool-derived-file-safety`, `renderer-main-boundary`

Related task: `acp-media-attachments`

## Trust Boundaries And Ownership

Renderer owns attachment parsing, timeline projection, presentation, and click routing. Electron Main owns ACP session and relative-path context, filesystem and URI validation, scoped reads, and operating-system open actions. Renderer-provided URIs, metadata, staging ids, transcript message ids, and attachment references are untrusted inputs.

An attachment source reference conceptually identifies the active ACP session key, generation, original URI, and optional Main-issued staging or transcript evidence. A resolved local or remote reference repeats that routing identity. These references and Renderer-visible attachment ids are not bearer capabilities. Exact current fields, result unions, error values, and operation signatures in `shared/host-api/contract.ts` and `src/lib/acp/timeline-types.ts` are authoritative.

Renderer reaches attachment operations only through the typed host API. Main exposes resolution, bounded text and binary reads, and click-initiated open. A successful resolution supplies display metadata, a non-sensitive opaque identity, and an attachment-scoped target, but it does not authorize a later read or open.

## Grant Lifecycle

ACP session load or creation is the only operation that establishes attachment session and relative-path context. Main canonicalizes the selected workspace root and execution cwd, verifies that both are directories and cwd is contained by the workspace, and commits the context only after the ACP operation succeeds. A failed load restores the prior ACP state and prior context. Switching the active session or advancing generation replaces that context.

Every attachment operation looks up the one active Main-owned context by exact session key and generation. Attachment, preview, and open payloads cannot provide or replace the execution cwd. Generation is a revocation and race token used together with session identity; it is not a globally monotonic credential.

## Local Resolution And Special Scopes

An accepted absolute, home-relative, `file:`, or execution-cwd-relative reference may resolve to any existing regular local file, including a file outside the active workspace or managed OpenClaw directories. The target is canonicalized before use. The local `scope` returned to Renderer is classification metadata for existing UI behavior, not an authorization root:

- `workspace`: the canonical target is inside the active ACP workspace root. Relative references resolve from the registered execution cwd.
- `openclaw-media`: the canonical target is outside the workspace. This legacy scope name does not imply containment under an OpenClaw media root.
- `staging`: when a staging id is supplied, it must match the exact canonical file in the Main-owned staging record. The same file may also resolve from an explicit path without claiming staging identity.
- `remote`: a normalized HTTP or HTTPS URL without embedded credentials. Remote references remain session/generation scoped and are revalidated immediately before external open.

Gateway outgoing media remains a record-bound special case, not a general local URL alias. Main validates the outgoing attachment id, requires the URL session key and managed record `sessionKey` to equal the active ACP session key, requires the record attachment id to match, and resolves the record's original file through a managed media root. If both transcript evidence and the record carry a message id, they must agree. The literal `global` session key follows exact equality and is never a wildcard.

## Path And URI Hardening

Main applies syntax checks before ownership checks and authorization again before each side effect. Current defenses include:

- Reject empty, NUL-containing, traversal-bearing, unknown-scheme, UNC, network-share, and overlong source references. The current source-reference bound is `4096` characters.
- Decode percent-encoded input once through platform URL handling, then reject encoded traversal or NUL content as well.
- Accept `file:` URLs only with an empty authority or local `localhost` authority; reject remote authorities and credentials.
- Accept only HTTP and HTTPS remote URLs, require a host, reject credentials, and use the platform URL normalization for identity and open.
- Resolve home-relative, absolute, Windows-drive, and execution-cwd-relative local references without treating a Renderer-provided path as an authorization root.
- Require an existing regular file and canonicalize the target. Symlink targets and files outside the workspace are allowed after canonical resolution.

Main re-resolves the original reference for every operation. Scoped reads open the canonical file without following a final symlink where the platform supports it, verify that the handle is a regular file, recheck the active generation, and read through that handle. Local system open re-resolves immediately before `shell.openPath`; remote open revalidates the normalized URL and active generation before `shell.openExternal`. A prior resolve result alone never authorizes a later side effect.

## Opaque Identity And Safe Labels

After authorization, Main returns an opaque hash derived from the canonical local target or normalized remote URL. Renderer uses that value for turn-scoped deduplication and diagnostics, but it must not expose a sensitive host path or be treated as access authority.

Display labels come from approved metadata or a decoded basename. Main reduces labels to a basename, removes control and bidirectional-formatting characters, collapses whitespace to one line, applies the current length bound, and falls back to a generic attachment label. Available attachment cards separately show the decoded local path or normalized remote URL represented by the explicit source reference; unavailable cards remain basename-only. Main-owned staging metadata may provide the original user-selected display path.

## Preview And Open Routing

The shared Renderer classifier in `src/lib/file-preview-capabilities.ts` decides whether a session-valid local attachment fits an existing inline viewer and its size cap. Supported text/code, HTML, CSV, image, PDF, and spreadsheet targets use the right-side Preview panel. Unsupported, known binary, audio/video, archive, office-document, or over-limit local targets use the system application only after a user click. HTTP and HTTPS targets open externally only after a user click.

Every attachment preview carries an attachment-scoped file reference. Preview components and rich viewers must use the attachment text or binary read operations and must not fall back to a naked path or general workspace read. Attachment previews also omit trusted workspace-browser reveal or folder actions.

## Failure Isolation

An invalid, stale, missing, unsafe, or non-file reference becomes an unavailable attachment result. It cannot be previewed or opened, but it does not suppress assistant prose or independently valid attachments. A valid existing file does not become unavailable merely because it is outside the workspace. Read failures remain inside the Preview panel; local or remote open failures use the localized non-blocking Chat error path. Transcript fetch or compatibility resolution failure must not turn a successful ACP prompt into a prompt error.

Diagnostics may record bounded reason codes, source kind, session/generation routing data, and hashed identities. They must not contain transcript bodies, file content, credentials, or full sensitive paths.

## Validation Anchors

Authorization and race coverage lives primarily in `tests/unit/acp-session-access-registry.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/files-api-workspace.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/unit/file-preview-body.test.tsx`, `tests/unit/rich-file-viewers.test.tsx`, `tests/unit/artifact-panel.test.tsx`, and `tests/e2e/chat-acp-attachments.spec.ts`.

Parser, protocol mapping, ordering, deduplication, and component behavior are covered by `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-reducer.test.ts`, `tests/unit/acp-timeline-groups.test.ts`, and `tests/unit/acp-chat-components.test.tsx`.
