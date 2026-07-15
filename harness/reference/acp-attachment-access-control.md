# ACP Attachment Access Control

Status: current security and ownership reference, reviewed 2026-07-15.

Related scenario: `acp-chat-experience`

Related rules: `attachment-access-safety`, `session-workspace-authority`, `tool-derived-file-safety`, `renderer-main-boundary`

Related task: `acp-media-attachments`

## Trust Boundaries And Ownership

Renderer owns attachment parsing, timeline projection, presentation, and click routing. Electron Main owns the ACP workspace grant, filesystem and URI authorization, scoped reads, and operating-system open actions. Renderer-provided URIs, metadata, staging ids, transcript message ids, and attachment references are untrusted inputs.

An attachment source reference conceptually identifies the active ACP session key, generation, original URI, and optional Main-issued staging or transcript evidence. A resolved local or remote reference repeats that routing identity. These references and Renderer-visible attachment ids are not bearer capabilities. Exact current fields, result unions, error values, and operation signatures in `shared/host-api/contract.ts` and `src/lib/acp/timeline-types.ts` are authoritative.

Renderer reaches attachment operations only through the typed host API. Main exposes resolution, bounded text and binary reads, and click-initiated open. A successful resolution supplies display metadata, a non-sensitive opaque identity, and an attachment-scoped target, but it does not authorize a later read or open.

## Grant Lifecycle

ACP session load or creation is the only workspace grant boundary. Main canonicalizes the selected workspace root and execution cwd, verifies that both are directories and cwd is contained by the workspace, and commits the context only after the ACP operation succeeds. A failed load restores the prior ACP state and prior grant. Switching the active session or advancing generation replaces the active grant.

Every attachment operation looks up the one active Main-owned context by exact session key and generation. Attachment, preview, and open payloads cannot provide or replace a workspace root. Generation is a revocation and race token used together with session identity; it is not a globally monotonic credential.

## Allowed Ownership Scopes

Current local access is limited to these ownership scopes:

- `workspace`: a regular file canonically contained by the active ACP workspace root. Relative references resolve from the registered execution cwd.
- `openclaw-media`: a regular file under the exact `<openclaw-state>/media` or `<openclaw-config>/media` subtree resolved from the same runtime configuration used by OpenClaw. The current distributed runtime has no separate external media-root setting, so no parent-directory or generic external-root expansion is allowed.
- `staging`: the exact canonical file bound to a Main-owned id created by ClawX staging. Merely placing or naming a path under the staging parent does not confer staging ownership.
- `remote`: a normalized HTTP or HTTPS URL without embedded credentials. Remote references remain session/generation scoped and are revalidated immediately before external open.

State and config parents, transcripts, credentials, stores, workspaces, sandboxes, canvas directories, staging files without their Main-owned id, and outgoing record files themselves are not attachment roots.

Gateway outgoing media is a record-bound form of `openclaw-media`, not a general local URL allowlist. Main validates the outgoing attachment id, requires the URL session key and managed record `sessionKey` to equal the active ACP session key, requires the record attachment id to match, and resolves the record's original file through an allowed managed-media root. If both transcript evidence and the record carry a message id, they must agree. The literal `global` session key follows exact equality and is never a wildcard.

## Path And URI Hardening

Main applies syntax checks before ownership checks and authorization again before each side effect. Current defenses include:

- Reject empty, NUL-containing, traversal-bearing, unknown-scheme, UNC, network-share, and overlong source references. The current source-reference bound is `4096` characters.
- Decode percent-encoded input once through platform URL handling, then reject encoded traversal or NUL content as well.
- Accept `file:` URLs only with an empty authority or local `localhost` authority; reject remote authorities and credentials.
- Accept only HTTP and HTTPS remote URLs, require a host, reject credentials, and use the platform URL normalization for identity and open.
- Resolve home-relative, absolute, Windows-drive, and execution-cwd-relative local references without treating a Renderer-provided path as an authorization root.
- Require an existing regular file and enforce lexical, realpath, symlink, and allowed-root containment.
- Freeze canonical workspace and managed-media authority so later parent replacement or symlink substitution cannot silently widen access.

Main re-resolves the original reference for every operation. Scoped reads open the file without following a final symlink where the platform supports it, compare the opened handle with the current canonical path and file identity, recheck containment and active generation, and read through that verified handle. Local system open re-resolves immediately before `shell.openPath`; remote open revalidates the normalized URL and active generation before `shell.openExternal`. These checks limit time-of-check/time-of-use substitution rather than relying on a prior resolve result.

## Opaque Identity And Safe Labels

After authorization, Main returns an opaque hash derived from the canonical local target or normalized remote URL. Renderer uses that value for turn-scoped deduplication and diagnostics, but it must not expose a sensitive host path or be treated as access authority.

Display labels come from approved metadata or a decoded basename. Main reduces them to a basename, removes control and bidirectional-formatting characters, collapses whitespace to one line, applies the current length bound, and falls back to a generic attachment label. Assistant and unavailable attachment cards remain basename-only. Main-owned staging metadata may separately provide the user-selected source path for the established user-attachment presentation; ACP or transcript metadata cannot do so.

## Preview And Open Routing

The shared Renderer classifier in `src/lib/file-preview-capabilities.ts` decides whether an authorized local attachment fits an existing inline viewer and its size cap. Supported text/code, HTML, CSV, image, PDF, and spreadsheet targets use the right-side Preview panel. Unsupported, known binary, audio/video, archive, office-document, or over-limit local targets use the system application only after a user click. HTTP and HTTPS targets open externally only after a user click.

Every attachment preview carries an attachment-scoped file reference. Preview components and rich viewers must use the attachment text or binary read operations and must not fall back to a naked path or general workspace read. Attachment previews also omit trusted workspace-browser reveal or folder actions.

## Failure Isolation

An invalid, stale, missing, unsafe, non-file, or outside-root reference becomes an unavailable attachment result. It cannot be previewed or opened, but it does not suppress assistant prose or independently valid attachments. Read failures remain inside the Preview panel; local or remote open failures use the localized non-blocking Chat error path. Transcript fetch or compatibility resolution failure must not turn a successful ACP prompt into a prompt error.

Diagnostics may record bounded reason codes, source kind, session/generation routing data, and hashed identities. They must not contain transcript bodies, file content, credentials, or full sensitive paths.

## Validation Anchors

Authorization and race coverage lives primarily in `tests/unit/acp-session-access-registry.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/files-api-workspace.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/unit/file-preview-body.test.tsx`, `tests/unit/rich-file-viewers.test.tsx`, `tests/unit/artifact-panel.test.tsx`, and `tests/e2e/chat-acp-attachments.spec.ts`.

Parser, protocol mapping, ordering, deduplication, and component behavior are covered by `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-reducer.test.ts`, `tests/unit/acp-timeline-groups.test.ts`, and `tests/unit/acp-chat-components.test.tsx`.
