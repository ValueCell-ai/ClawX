# ACP Media Attachments Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render standard ACP resources and bounded OpenClaw `MEDIA:` transcript supplements as secure, actionable attachment cards in ACP Chat.

**Architecture:** Standard ACP `resource_link` and URI-backed `resource` blocks become pending attachment parts and are resolved through a Main-owned session access boundary. Because the distributed OpenClaw ACP adapter drops assistant media, Renderer performs a marked, bounded transcript supplement after prompt completion and history load, then feeds those references through the same resolver, turn-level display, preview, and open pipeline.

**Tech Stack:** Electron 40, React 19, TypeScript, Zustand, `@agentclientprotocol/sdk`, Vite, Vitest, Playwright, react-i18next, existing typed host-api and ArtifactPanel preview stack.

## Global Constraints

- Do not modify OpenClaw source, `node_modules/openclaw`, bundled OpenClaw output, or the distributed package.
- ACP replay remains the primary Chat history authority. Transcript reads recover only explicit assistant `MEDIA:` attachments omitted by OpenClaw ACP.
- Add the approved compatibility rationale comment at the transcript supplement entry point and link it to `harness/reference/acp-generated-media-and-diagnostics.md`.
- Parse only line-leading `MEDIA:` directives outside fenced code blocks. Do not parse bare paths or inline prose.
- Query no more than 1000 transcript messages per supplement.
- Perform one immediate live transcript query and one retry exactly 1500 ms later. Do not add indefinite polling.
- Reject stale work by exact session key, ACP generation, supplement operation id, and live user-turn identity.
- Resolve source references no longer than 4096 characters.
- Local assistant attachments are limited to the active ACP workspace grant, exact OpenClaw media subtrees, verified outgoing records, or Main-owned ClawX staging ids.
- The ACP load/new operation is the only workspace capability-grant boundary. Attachment operations cannot supply or replace a workspace root.
- Every attachment resolve, read, and open operation must re-check session, generation, roots, canonical paths, symlink containment, and resource syntax in Main.
- Local attachments use `shell.openPath` only through `files.openAttachment`; HTTP/HTTPS attachments use `shell.openExternal` only through the same validated operation.
- Render assistant attachments after all normal assistant-turn timeline items and before the existing file-activity summary. Render user attachments after user prose.
- Native ACP evidence wins over compatibility evidence for the same resolved target.
- An unavailable immediate result may become available on the delayed retry; do not permanently reserve failed identities.
- Preserve the existing inline image-generation UI. Share transcript fetch and identity helpers only; do not convert generated images to paperclip cards.
- Route every new user-visible string through `react-i18next` with `en`, `zh`, `ja`, and `ru` coverage.
- Use design tokens and component substitutions documented in `src/styles/globals.css`.
- Renderer uses `src/lib/host-api.ts`; do not add direct IPC, Gateway HTTP, or Gateway WebSocket calls.
- Start backend communication work from `harness/specs/tasks/acp-media-attachments.md` and validate that task before implementation review.
- Run `pnpm run comms:replay` and `pnpm run comms:compare` before completion.

---

### Task 1: Harness Contract And Compatibility Rules

**Files:**
- Create: `harness/specs/tasks/acp-media-attachments.md`
- Create: `harness/specs/rules/acp-compatibility-content-safety.md`
- Create: `harness/specs/rules/diagnostics-trace-safety.md`
- Create: `harness/specs/rules/ui-i18n-design-tokens.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/session-workspace-authority.md`
- Modify: `harness/specs/rules/tool-derived-file-safety.md`
- Test: `tests/unit/harness-specs.test.ts`

**Interfaces:**
- Consumes: Approved design in `docs/specs/2026-07-14-acp-media-attachments-design.md`.
- Produces: Validated task id `acp-media-attachments` and durable rules for later code, tests, and documentation.

- [ ] **Step 1: Write and run the failing harness test**

Add assertions in `tests/unit/harness-specs.test.ts` that `acp-media-attachments` exists, resolves all required rules, includes the `e2e` profile, and that the ACP Chat scenario owns `tests/e2e/chat-acp-attachments.spec.ts`.

Run:

```bash
pnpm exec vitest run tests/unit/harness-specs.test.ts
```

Expected: failure because the task and missing rules do not exist yet.

- [ ] **Step 2: Write the task spec and missing rule specs**

Create `harness/specs/tasks/acp-media-attachments.md` with:

```yaml
---
id: acp-media-attachments
title: Render ACP resources and bounded OpenClaw MEDIA attachments
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Render standard ACP resources and recover only explicit OpenClaw MEDIA attachments omitted by the distributed ACP adapter through a bounded transcript compatibility projection.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - diagnostics-trace-safety
  - session-workspace-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
docs:
  required: true
---
```

List every expected path from this plan in `touchedAreas`, including shared contracts, Main services, ACP Renderer modules, preview components, locales, tests, harness references, and READMEs. Copy the approved acceptance behavior into `expectedUserBehavior` and `acceptance` without introducing bare-path extraction.

Define `acp-compatibility-content-safety` to permit only marked, in-memory, reason-coded supplements backed by explicit structured or transcript evidence and to prohibit ordinary message reconstruction. Define `diagnostics-trace-safety` to prohibit transcript bodies, credentials, file contents, and raw sensitive paths. Define `ui-i18n-design-tokens` from the existing `AGENTS.md` and `globals.css` conventions.

Update `acp-chat-state-and-history` so the approved transcript exceptions are image-generation completion and explicit OpenClaw `MEDIA:` attachment recovery only. Update `tool-derived-file-safety` to distinguish incidental tool paths, which remain preview-only, from explicit user-facing attachment evidence validated through the new Main attachment boundary.

- [ ] **Step 3: Run harness validation**

Run:

```bash
pnpm exec vitest run tests/unit/harness-specs.test.ts
pnpm harness validate --spec harness/specs/tasks/acp-media-attachments.md
pnpm harness run --spec harness/specs/tasks/acp-media-attachments.md --dry-run
```

Expected: all commands succeed; the dry run selects fast, comms, and e2e validation without missing rule ids.

- [ ] **Step 4: Commit the harness contract**

```bash
git add harness/specs/tasks/acp-media-attachments.md harness/specs/rules/acp-compatibility-content-safety.md harness/specs/rules/diagnostics-trace-safety.md harness/specs/rules/ui-i18n-design-tokens.md harness/specs/scenarios/acp-chat-experience.md harness/specs/rules/acp-chat-state-and-history.md harness/specs/rules/session-workspace-authority.md harness/specs/rules/tool-derived-file-safety.md tests/unit/harness-specs.test.ts
git commit -m "test: define ACP attachment harness contract"
```

---

### Task 2: Main-Owned ACP Session Access Registry

**Files:**
- Create: `electron/services/acp-session-access-registry.ts`
- Modify: `shared/acp-chat/types.ts`
- Modify: `electron/services/acp-chat-service.ts`
- Modify: `electron/services/chat-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `src/pages/Chat/index.tsx`
- Test: `tests/unit/acp-session-access-registry.test.ts`
- Test: `tests/unit/acp-chat-service.test.ts`
- Test: `tests/unit/chat-acp-page.test.tsx`

**Interfaces:**
- Consumes: `AcpChatLoadPayload`, ACP generation semantics, and effective workspace selection.
- Produces: `AcpSessionAccessRegistry`, `AcpSessionAccessContext`, and a registered workspace grant keyed by exact session and generation for Task 3.

- [ ] **Step 1: Write failing registry and ACP service tests**

Add `tests/unit/acp-session-access-registry.test.ts` for these exact behaviors:

- `prepareGrant({ sessionKey, generation, workspaceRoot, executionCwd })` canonicalizes directories and rejects cwd outside root.
- `commitGrant(prepared)` makes only the exact session/generation available.
- A later generation invalidates an older lookup.
- Restoring a captured previous snapshot after failed load restores the previous grant.
- Attachment callers cannot pass a replacement root to `get(sessionKey, generation)`.

Extend `tests/unit/acp-chat-service.test.ts` so a successful `loadSession` commits the canonical grant only after `newSession` or `loadSession` resolves, and a failed load restores the previous grant. Assert `sendPrompt` rejects a cwd that differs from the registered execution cwd.

Extend `tests/unit/chat-acp-page.test.tsx` to expect `loadAcpSession` input to include both `workspaceRoot` and `cwd` for default, selected, and target-agent workspaces.

Add a user-attachment assertion that `FileAttachment.id` is preserved as `AcpPromptMediaItem.stagingId` instead of being dropped when Chat maps composer attachments into the ACP prompt.

Run:

```bash
pnpm exec vitest run tests/unit/acp-session-access-registry.test.ts tests/unit/acp-chat-service.test.ts tests/unit/chat-acp-page.test.tsx
```

Expected: failures for the missing registry and missing `workspaceRoot` payload.

- [ ] **Step 2: Extend ACP payload types**

Change the shared load payload to:

```ts
export type AcpChatLoadPayload = AcpSessionKeyPayload & {
  workspaceRoot: string;
  cwd: string;
  createIfMissing?: boolean;
};
```

Keep `AcpChatPromptPayload.cwd` and require Main to compare it with the registered execution cwd. Add `workspaceRoot` to Renderer ACP store state so `prepareLocalSession`, `loadSession`, and subsequent prompt operations retain one effective grant.

Extend user media with the existing Main-issued staging identity:

```ts
export type AcpPromptMediaItem = {
  filePath: string;
  stagingId: string;
  fileName?: string;
  mimeType?: string;
};
```

- [ ] **Step 3: Implement the registry and inject one instance**

Implement:

```ts
export type AcpSessionAccessContext = {
  sessionKey: string;
  generation: number;
  workspaceRoot: string;
  executionCwd: string;
};

export class AcpSessionAccessRegistry {
  prepareGrant(input: AcpSessionAccessContext): Promise<AcpSessionAccessContext>;
  snapshot(): AcpSessionAccessContext | null;
  commitGrant(context: AcpSessionAccessContext): void;
  restore(snapshot: AcpSessionAccessContext | null): void;
  get(sessionKey: string, generation: number): AcpSessionAccessContext | null;
}
```

Use `realpath`, directory stats, and `path.relative` containment. Do not expose a method that accepts a workspace root during an attachment lookup.

Create one registry in `registerTypedHostHandlers`. Pass it through `createChatApi` into `AcpChatService`; Task 3 will pass the same instance to `createFilesApi`.

In `AcpChatService.loadSession`, prepare the grant before invoking ACP, snapshot prior state, commit only after success, and restore on failure with the existing ACP state rollback. Keep `_meta.prefixCwd: true`.

- [ ] **Step 4: Update Renderer workspace inputs**

Pass the effective selected workspace as `workspaceRoot` and execution directory as `cwd` from `src/pages/Chat/index.tsx`. For current behavior they may be equal, but preserve separate fields so nested execution cwd remains representable. Ensure target-agent sends load the target agent workspace grant before prompting. Map `FileAttachment.id` to `AcpPromptMediaItem.stagingId` together with its staged path.

In `AcpChatService.buildPromptBlocks`, include ClawX-owned metadata on non-image user resources:

```ts
{
  type: 'resource_link',
  uri: media.filePath,
  name: media.fileName,
  mimeType: media.mimeType,
  _meta: { clawx: { stagingId: media.stagingId } },
}
```

The optimistic user segment and replayed ACP user resource can therefore recover the staging id without accepting a raw staging path as proof of ownership.

- [ ] **Step 5: Run focused regressions**

Run:

```bash
pnpm exec vitest run tests/unit/acp-session-access-registry.test.ts tests/unit/acp-chat-service.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/acp-chat-store.test.ts
pnpm run typecheck:node
pnpm run typecheck:web
```

Expected: all pass; existing ACP load rollback, generation, optimistic prompt, and workspace tests remain green.

- [ ] **Step 6: Commit the workspace grant boundary**

```bash
git add shared/acp-chat/types.ts electron/services/acp-session-access-registry.ts electron/services/acp-chat-service.ts electron/services/chat-api.ts electron/main/ipc-handlers.ts src/stores/acp-chat-session.ts src/pages/Chat/index.tsx tests/unit/acp-session-access-registry.test.ts tests/unit/acp-chat-service.test.ts tests/unit/chat-acp-page.test.tsx
git commit -m "feat: register ACP session workspace access"
```

---

### Task 3: Typed Attachment Resolve, Read, And Open Boundary

**Files:**
- Create: `electron/services/attachment-access.ts`
- Create: `shared/file-preview/limits.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/files-api.ts`
- Modify: `electron/services/acp-trace.ts`
- Modify: `electron/services/media-api.ts`
- Modify: `electron/services/sessions-api.ts`
- Modify: `electron/utils/paths.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/lib/file-preview-client.ts`
- Test: `tests/unit/attachment-access.test.ts`
- Test: `tests/unit/files-api-workspace.test.ts`
- Test: `tests/unit/media-api.test.ts`
- Test: `tests/unit/sessions-api-workspace.test.ts`
- Test: `tests/unit/acp-trace.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`
- Test: `tests/unit/host-services.test.ts`

**Interfaces:**
- Consumes: Exact session/generation lookup from `AcpSessionAccessRegistry`.
- Produces: `AttachmentSourceRef`, `AttachmentFileRef`, `AttachmentRemoteRef`, resolve/read/open contracts, and Renderer host facade methods for Tasks 4-6.

- [ ] **Step 1: Define failing security tests**

Create `tests/unit/attachment-access.test.ts` with temporary workspace, OpenClaw state, config, media, outgoing record, staging, and outside directories. Cover:

- Workspace file resolves only through the registered session/generation.
- An outside path cannot redefine or escape the workspace grant.
- `<state>/media` and `<config>/media` files resolve; their parent directories and sibling config/transcript files do not.
- Undeclared external media directories do not resolve.
- A staged file resolves only by its Main-owned staging id, never by raw staging path.
- Outgoing URL attachment id, URL session key, record session key, and optional message id must match.
- `global` matches only a literal `global` record and is not a wildcard.
- Missing, directory, traversal, symlink escape, remote file authority, UNC/network path, encoded NUL, encoded traversal, URL credentials, unknown scheme, and references over 4096 characters fail closed.
- A previously resolved ref is rejected after generation changes.
- Text read, binary read, and open each re-resolve rather than trusting prior success.
- Local open delegates to mocked `shell.openPath`; remote open delegates to mocked `shell.openExternal` only for validated HTTP/HTTPS.
- Open success/failure trace records contain only reason code, source kind, session/generation, and hashed identity; they contain no URI or path.
- Display names remove controls and bidirectional formatting, collapse to one line, and are length-bounded.

Extend facade and host service tests to expect four new typed file actions.

Run:

```bash
pnpm exec vitest run tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
```

Expected: failures for missing contract and service operations.

- [ ] **Step 2: Add exact shared contracts**

Add these discriminated types to `shared/host-api/contract.ts`:

```ts
export type AttachmentSourceRef = {
  sessionKey: string;
  generation: number;
  uri: string;
  stagingId?: string;
  transcriptMessageId?: string;
};

export type AttachmentFileRef = AttachmentSourceRef;
export type AttachmentRemoteRef = AttachmentSourceRef;

export type ResolveAttachmentPayload = {
  ref: AttachmentSourceRef;
  name?: string;
  mimeType?: string;
  size?: number;
};

export type ResolveAttachmentResult =
  | {
      ok: true;
      identity: string;
      displayName: string;
      mimeType: string;
      size: number;
      target:
        | { kind: 'local'; scope: 'workspace' | 'openclaw-media' | 'staging'; ref: AttachmentFileRef }
        | { kind: 'remote'; ref: AttachmentRemoteRef; url: string };
    }
  | { ok: false; displayName: string; error: AttachmentAccessError };
```

Define finite `AttachmentAccessError` values for invalid reference, stale session, outside allowed roots, unavailable, not file, unsafe URL, and operation failure. Add `readAttachmentText`, `readAttachmentBinary`, and `openAttachment` payload/results to `HostApiContract.files`.

Extend `MediaThumbnailEntry` with `attachmentFileRef?: AttachmentFileRef` and `key?: string`. Attachment callers set `key` to Main's opaque resolved identity, and `MediaThumbnailResult` returns that preview under the same key. When `attachmentFileRef` is present, `media.thumbnails` must revalidate and read through attachment access rather than a raw path. This gives image-generation compatibility a secure preview path without exposing canonical files to Renderer.

Use the same type in Renderer timeline state:

```ts
export type AttachmentUnavailableReason = AttachmentAccessError;
```

Create `shared/file-preview/limits.ts` with the existing exact values:

```ts
export const FILE_PREVIEW_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const FILE_PREVIEW_MAX_BINARY_BYTES = 50 * 1024 * 1024;
```

Use the shared constants from Main and later Renderer code.

- [ ] **Step 3: Centralize OpenClaw state and media paths**

Add the following exact utilities to `electron/utils/paths.ts`:

```ts
resolveOpenClawStateDir(env = process.env): string
resolveOpenClawConfigPath(env = process.env): string
resolveOpenClawConfigDir(env = process.env): string
```

`resolveOpenClawStateDir` uses expanded, absolute `OPENCLAW_STATE_DIR`, then falls back to `~/.openclaw`. `resolveOpenClawConfigPath` uses expanded, absolute `OPENCLAW_CONFIG_PATH`, then `<stateDir>/openclaw.json`. `resolveOpenClawConfigDir` returns the dirname of that config path. Session databases, agent session stores, and transcripts remain under the state directory; config-relative media uses the config dirname; outgoing records use the state media directory.

Update `sessions-api.ts`, media outgoing record lookup, and attachment access to call the correct utility. Add `sessions-api-workspace.test.ts` coverage proving `sessions.history` finds transcripts under a custom `OPENCLAW_STATE_DIR` even when `OPENCLAW_CONFIG_PATH` points elsewhere. Do not migrate unrelated config writers in this feature.

Allow only exact media roots:

- `<state>/media`
- `<config>/media`
- An explicit external media root present in the runtime launch configuration

Never authorize the parent state/config directory, workspace, sandbox, canvas, logs, credentials, or session transcripts as media.

- [ ] **Step 4: Implement attachment normalization and authorization**

Implement `createAttachmentAccess(...)` and a small `StagedAttachmentRegistry` in `electron/services/attachment-access.ts` with injected ACP registry, path roots, staging lookup, fs operations, and shell operations for tests.

Normalize references once using `URL` and platform path APIs. Permit empty or `localhost` file authority only. Reject URL credentials. After decoding, repeat NUL and traversal checks. Use canonical path containment and safe-open patterns from `files-api.ts`; extract only the minimal reusable fs-safe helpers instead of duplicating security logic.

Return a hashed opaque identity, not a raw canonical path. Retain the original URI in `AttachmentFileRef` so each read/open can resolve again through the registry.

Move outgoing record parsing from `media-api.ts` into a reusable helper that validates attachment id, URL session, record session, optional message id, and media-root containment. Inject attachment access into `createMediaApi` and support `attachmentFileRef` thumbnail entries while keeping existing raw thumbnail behavior for non-attachment callers unchanged.

- [ ] **Step 5: Register file actions and staging ownership**

In `registerTypedHostHandlers`, instantiate one staged registry and one attachment access service from the Task 2 ACP registry. Inject attachment access and the staged registry into `createFilesApi`, and inject attachment access into `createMediaApi`. Keep a Main-owned map from every `files.stagePaths`/`files.stageBuffer` result id to its canonical staged file. Register:

```ts
resolveAttachment(payload)
readAttachmentText(ref)
readAttachmentBinary({ ref, maxBytes? })
openAttachment(ref)
```

`openAttachment` revalidates and invokes `shell.openPath` or `shell.openExternal` internally. Do not expose resolved local paths to Renderer. Add matching methods to `src/lib/host-api.ts` and `src/lib/file-preview-client.ts`.

Record Main attachment open success/failure through the existing ACP trace sanitizer. Submit only bounded reason codes and hashed identities.

- [ ] **Step 6: Run focused Main and contract tests**

Run:

```bash
pnpm exec vitest run tests/unit/attachment-access.test.ts tests/unit/files-api-workspace.test.ts tests/unit/media-api.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/acp-trace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/acp-chat-service.test.ts
pnpm run typecheck:node
pnpm run typecheck:web
```

Expected: all pass; no path-only attachment read/open action exists and media thumbnail regressions remain green.

- [ ] **Step 7: Commit the Main attachment boundary**

```bash
git add shared/host-api/contract.ts shared/file-preview/limits.ts electron/services/attachment-access.ts electron/services/files-api.ts electron/services/acp-trace.ts electron/services/media-api.ts electron/services/sessions-api.ts electron/utils/paths.ts electron/main/ipc-handlers.ts src/lib/host-api.ts src/lib/file-preview-client.ts tests/unit/attachment-access.test.ts tests/unit/files-api-workspace.test.ts tests/unit/media-api.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/acp-trace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
git commit -m "feat: add scoped attachment file access"
```

---

### Task 4: Standard ACP Attachment Model And Resolution

**Files:**
- Create: `src/lib/acp/attachments.ts`
- Modify: `src/lib/acp/timeline-types.ts`
- Modify: `src/lib/acp/content-blocks.ts`
- Modify: `src/lib/acp/reducer.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Test: `tests/unit/acp-reducer.test.ts`
- Test: `tests/unit/acp-chat-store.test.ts`
- Test: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: Task 3 resolve contract and host facade.
- Produces: `AttachmentRenderPart`, deterministic attachment ids, async pending-to-resolved hydration, and native-over-compat dedupe for Tasks 5-6.

- [ ] **Step 1: Write failing ACP conversion and hydration tests**

Extend reducer tests with standard `agent_message_chunk` cases:

- `resource_link` preserves `uri`, `name` with `title` fallback, `mimeType`, and `size`.
- URI-backed `resource` becomes an attachment; a resource without usable URI becomes unavailable instead of crashing.
- Native attachments start `access.status === 'pending'` with deterministic ids based on message/segment/block position.
- A ClawX user `resource_link` preserves `_meta.clawx.stagingId`; arbitrary provider metadata cannot claim a staging id for an assistant attachment.

Extend store tests:

- Applying an envelope resolves every new pending attachment through `hostApi.files.resolveAttachment`.
- Resolution updates only the matching session/generation and attachment id.
- Stale resolution is dropped.
- A native resolved identity replaces a compatibility part with the same identity.
- A compatibility inline image carrying `mediaIdentity` suppresses or replaces an attachment card with the same resolved identity regardless of arrival order.
- Unavailable resolution remains renderable and can be retried.

Run:

```bash
pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx
```

Expected: failures for the absent attachment model and resolver calls.

- [ ] **Step 2: Define attachment timeline types and helpers**

Implement the approved `AttachmentRenderPart` and access union in `src/lib/acp/timeline-types.ts`, importing shared host ref types rather than redefining them. Replace `kind: 'file'` with `kind: 'attachment'` throughout ACP code and tests.

Extend the existing image render part only with optional compatibility metadata:

```ts
{ kind: 'image'; source: string; mimeType?: string; alt?: string; mediaIdentity?: string }
```

Standard ACP images need not set it. Image-generation compatibility projections set it after Main resolution so turn-level dedupe can prefer the existing inline image over a paperclip card for the same media.

Create pure helpers in `src/lib/acp/attachments.ts`:

```ts
createPendingAttachment(...): AttachmentRenderPart
collectPendingAttachments(snapshot): PendingAttachmentLocation[]
applyAttachmentResolution(snapshot, input): AcpTimelineSnapshot
dedupeTurnAttachments(parts): AttachmentRenderPart[]
```

Native source priority must be greater than `openclaw-media`. Existing image-generation inline images take display priority over attachment cards with the same `mediaIdentity`. Do not commit unavailable identities into resolved dedupe state.

- [ ] **Step 3: Convert standard ACP blocks**

Update `contentBlockToRenderPart` to preserve standard metadata. Keep images on the existing image path. Sanitize only display labels in Main resolution; retain protocol URI in the pending reference for authorization.

Change conversion to accept message context:

```ts
contentBlockToRenderPart(block, {
  role: 'user' | 'assistant',
  messageId,
  segmentIndex,
  blockIndex,
})
```

Read `_meta.clawx.stagingId` only when `role === 'user'`; assistant ACP resources cannot claim ClawX staging ownership through metadata.

Build attachment ids from `messageId`, `segmentIndex`, and `blockIndex`. Add a reducer test where one message emits resources in segments on both sides of a tool call with the same local block index; resolution must patch the correct distinct attachment.

- [ ] **Step 4: Hydrate pending attachments in the ACP store**

After `applyAcpSessionUpdate`, collect only newly added pending attachments, call `hostApi.files.resolveAttachment` with active session and generation, and patch results by attachment id. Use a per-session in-flight key so repeated chunks do not duplicate resolve requests.

Do not block ordinary ACP update rendering while resolution runs. A minimal pending static card in `AcpMessageSegment.tsx` keeps this task compiling; Task 5 adds final interaction and turn-level layout.

- [ ] **Step 5: Run focused ACP regressions**

Run:

```bash
pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/acp-image-generation-compat.test.ts
pnpm run typecheck:web
```

Expected: all pass; image blocks and image-generation projection remain unchanged.

- [ ] **Step 6: Commit standard ACP attachment support**

```bash
git add src/lib/acp/attachments.ts src/lib/acp/timeline-types.ts src/lib/acp/content-blocks.ts src/lib/acp/reducer.ts src/stores/acp-chat-session.ts src/pages/Chat/AcpMessageSegment.tsx tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx
git commit -m "feat: resolve standard ACP attachments"
```

---

### Task 5: Attachment Card, Turn Layout, And Preview Routing

**Files:**
- Create: `src/pages/Chat/AcpAttachmentPart.tsx`
- Create: `src/lib/file-preview-capabilities.ts`
- Modify: `src/lib/generated-files.ts`
- Modify: `src/lib/acp/timeline-groups.ts`
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Modify: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `src/pages/Chat/AcpTimeline.tsx`
- Modify: `src/components/file-preview/types.ts`
- Modify: `src/components/file-preview/build-preview-target.ts`
- Modify: `src/components/file-preview/FilePreviewBody.tsx`
- Modify: `src/components/file-preview/ImageViewer.tsx`
- Modify: `src/components/file-preview/PdfViewer.tsx`
- Modify: `src/components/file-preview/SheetViewer.tsx`
- Modify: `src/components/file-preview/HtmlPreview.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-chat-components.test.tsx`
- Test: `tests/unit/file-preview-body.test.tsx`
- Test: `tests/unit/rich-file-viewers.test.tsx`
- Test: `tests/unit/generated-files.test.ts`

**Interfaces:**
- Consumes: Resolved `AttachmentRenderPart` and attachment-scoped read/open host methods.
- Produces: Final paperclip UI, body-before-attachments assistant layout, shared preview classification, and right-panel/system-open routing.

- [ ] **Step 1: Write failing component and viewer tests**

Add tests for:

- Paperclip icon, safe filename, pending state, unavailable disabled state, MIME/size secondary text, focus ring, keyboard activation, and accessible label.
- Supported XLSX click calls `useArtifactPanel.openPreview` with `attachmentFileRef` and never calls `openAttachment` immediately.
- ZIP/DOCX/audio/video click calls `hostApi.files.openAttachment` directly with no confirmation.
- HTTP/HTTPS click also calls `files.openAttachment`, not `shell.openExternal` from Renderer.
- A supported extension over the 2 MiB text or 50 MiB rich cap routes directly to system open.
- Assistant attachments emitted in an early segment render after later prose/tool items and before `AcpTurnFileActivity`.
- User resource attachments render after user prose.
- Image, PDF, spreadsheet, HTML, and text preview paths use `readAttachmentBinary` or `readAttachmentText` whenever `attachmentFileRef` exists and never fall back to workspace/naked-path reads.

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/generated-files.test.ts
```

Expected: failures for missing component, turn lifting, and attachment viewer routing.

- [ ] **Step 2: Centralize preview capability**

Create `src/lib/file-preview-capabilities.ts` with:

```ts
export type AttachmentOpenMode = 'preview' | 'system';
export function attachmentOpenMode(input: {
  ext: string;
  mimeType: string;
  size: number;
  target: AttachmentAccessTarget;
}): AttachmentOpenMode;
```

Reuse `classifyFileExt`, `supportsInlineDocumentPreview`, and shared size limits. Preview images, text/code, Markdown/HTML, PDF, XLS/XLSX, and CSV text. Return `system` for unsupported types and over-cap supported types. Make `FilePreviewBody` consume the same capability source where it chooses preview tabs.

- [ ] **Step 3: Add attachment-scoped preview targets**

Extend `FilePreviewTarget` with `attachmentFileRef?: AttachmentFileRef`. Include session, generation, and URI in `getFilePreviewTargetIdentity`. Add `buildAttachmentPreviewTarget(resolvedAttachment)` without exposing a canonical path.

Update `FilePreviewBody`, image, PDF, spreadsheet, and HTML paths so `attachmentFileRef` has highest read priority. Attachment previews are read-only and do not expose generic reveal/open controls inside the panel.

- [ ] **Step 4: Implement turn-level attachment display**

Update timeline grouping to return normal assistant items and ordered attachment parts separately. `AcpAssistantTurn` renders:

```text
normal message/thought/tool/permission/plan items
attachment list
file activity summary
```

Remove attachment parts from their original assistant segment render to avoid duplicates. Keep user attachment ordering inside the user group.

- [ ] **Step 5: Implement `AcpAttachmentPart`**

Use a semantic `<button>` for available attachments and a disabled status row for pending/unavailable attachments. Use `Paperclip`, `bg-surface-modal`, standard border/hover/focus tokens, and localized labels. Display filename only; do not put the raw absolute URI in title or accessible text.

On click:

- Preview mode calls `useArtifactPanel.getState().openPreview(buildAttachmentPreviewTarget(...))`.
- System or remote mode calls `hostApi.files.openAttachment(ref)` and surfaces a localized non-blocking error if it returns failure.

- [ ] **Step 6: Add all locale keys**

Add matching keys under `chat:acp.attachment` for loading, unavailable, open, preview, MIME/size labels, and open failure in all four locale files. Do not hardcode display strings.

- [ ] **Step 7: Run focused UI and preview tests**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/generated-files.test.ts tests/unit/artifact-panel.test.tsx
pnpm run typecheck:web
```

Expected: all pass; file-change preview and existing ArtifactPanel behavior remain green.

- [ ] **Step 8: Commit attachment UI and preview routing**

```bash
git add src/pages/Chat/AcpAttachmentPart.tsx src/lib/file-preview-capabilities.ts src/lib/generated-files.ts src/lib/acp/timeline-groups.ts src/pages/Chat/AcpMessageSegment.tsx src/pages/Chat/AcpAssistantTurn.tsx src/pages/Chat/AcpTimeline.tsx src/components/file-preview/types.ts src/components/file-preview/build-preview-target.ts src/components/file-preview/FilePreviewBody.tsx src/components/file-preview/ImageViewer.tsx src/components/file-preview/PdfViewer.tsx src/components/file-preview/SheetViewer.tsx src/components/file-preview/HtmlPreview.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/acp-chat-components.test.tsx tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/generated-files.test.ts
git commit -m "feat: render actionable ACP attachment cards"
```

---

### Task 6: OpenClaw MEDIA Transcript Compatibility Projection

**Files:**
- Create: `src/lib/acp/openclaw-media-compat.ts`
- Create: `src/lib/acp/transcript-supplement.ts`
- Modify: `src/lib/acp/attachments.ts`
- Modify: `src/lib/acp/reducer.ts`
- Modify: `src/lib/acp/image-generation-compat.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Test: `tests/unit/acp-media-attachments.test.ts`
- Test: `tests/unit/acp-chat-store.test.ts`
- Test: `tests/unit/acp-image-generation-compat.test.ts`
- Test: `tests/unit/acp-timeline-groups.test.ts`
- Test: `tests/unit/acp-trace.test.ts`

**Interfaces:**
- Consumes: Transcript `RawMessage[]`, active ACP timeline, Task 3 resolver, Task 4 attachment projection, and image-generation transcript extractor.
- Produces: Pure explicit-MEDIA extraction, reverse turn alignment, shared transcript fetch coordination, immediate plus 1500 ms live retry, and marked synthetic attachment segments.

- [ ] **Step 1: Write failing pure parser and alignment tests**

Create `tests/unit/acp-media-attachments.test.ts` with:

- POSIX absolute, Windows drive, `file://`, `~/`, relative cwd, HTTP, HTTPS, and quoted-space directives.
- Multiple line-leading directives preserve order.
- Fenced code directives, Markdown wrappers, inline prose, unknown schemes, and bare paths are rejected.
- Assistant messages only; user/tool/system messages do not produce candidates.
- Reference length over 4096 is rejected before Main resolution.
- Working-directory display envelope is removed only for user-turn matching, not arbitrary user text.
- Historical transcript suffix aligns newest-to-oldest against ACP user groups.
- Repeated identical prompts align by occurrence from the tail.
- Ambiguous or missing user anchor produces no projection.
- Attachment-only assistant output still creates a turn attachment projection.
- Evidence ids remain stable across immediate and delayed reads.
- An image-generation transcript candidate accepted by the existing `image_generate` extractor is suppressed from the general attachment extractor, so it renders only as the existing inline image.
- An explicit image MEDIA directive without proven `image_generate` context remains eligible for the general attachment path.
- Structured Gateway/runtime image-generation evidence is resolved through Main, stores `mediaIdentity` on the inline image, and suppresses a later transcript attachment with the same identity.
- Equivalent `/path/image.png`, `file:///path/image.png`, home-relative, relative-cwd, and outgoing Gateway references that Main resolves to one identity produce only the inline image.
- Arrival-order coverage proves attachment-first/image-late removes the card and image-first/attachment-late rejects the card.

Before implementation, also extend `tests/unit/acp-chat-store.test.ts` and `tests/unit/acp-trace.test.ts` with failing cases for:

- One history response feeds image-generation and general MEDIA extractors.
- Prompt success performs one immediate request and one retry at exactly 1500 ms using fake timers.
- New prompt, cancel, load, session switch, and generation change invalidate the pending retry.
- History request started/succeeded/failed, match/reject, resolution, dedupe, and stale projection traces contain no transcript body or raw URI.

Run:

```bash
pnpm exec vitest run tests/unit/acp-media-attachments.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-trace.test.ts tests/unit/acp-image-generation-compat.test.ts
```

Expected: failures because the compatibility module, coordinator, timing, suppression, and trace events do not exist.

- [ ] **Step 2: Implement the pure compatibility module**

Define:

```ts
export type OpenClawMediaCandidate = {
  evidenceId: string;
  transcriptMessageId?: string;
  uri: string;
  order: number;
};

export type OpenClawMediaTurnSupplement = {
  acpTurnId: string;
  candidates: OpenClawMediaCandidate[];
};

export type TranscriptMediaTurn = {
  normalizedUserText: string;
  userOccurrenceFromTail: number;
  candidates: OpenClawMediaCandidate[];
};

extractOpenClawMediaTurns(
  messages: RawMessage[],
  input: { executionCwd: string; suppressedUris: ReadonlySet<string> },
): TranscriptMediaTurn[]

alignOpenClawMediaTurns(
  snapshot: AcpTimelineSnapshot,
  transcriptTurns: TranscriptMediaTurn[],
  input: { liveUserMessageId?: string },
): OpenClawMediaTurnSupplement[]
```

Implement line/fence parsing without importing OpenClaw internals. The parser is intentionally narrower than OpenClaw and accepts one attachment per explicit line. Keep raw paths out of diagnostics.

- [ ] **Step 3: Add the required compatibility rationale comment and coordinator**

At the public transcript supplement entry point in `src/lib/acp/transcript-supplement.ts`, add the approved reason comment and link `harness/reference/acp-generated-media-and-diagnostics.md`.

Implement one coordinator that calls:

```ts
hostApi.sessions.history({ sessionKey, limit: 1000 })
```

and sends the same response to image-generation extraction and general MEDIA extraction. Run image-generation extraction first, collect every accepted completion candidate key into `suppressedUris`, and pass that set to `extractOpenClawMediaTurns` as an early exact-key filter. It returns no ordinary messages to the timeline.

Exact-key suppression is only an optimization. Before projecting any image-generation completion from transcript, ACP tool output, Gateway chat evidence, or runtime events, resolve each candidate through `hostApi.files.resolveAttachment` and retain Main's opaque identity. Transcript candidates pass their `transcriptMessageId` in `AttachmentSourceRef` so outgoing-record message binding can be verified. For local resolved images, request the preview through `media.thumbnails({ paths: [{ attachmentFileRef, key: identity, mimeType }] })` and read `MediaThumbnailResult[identity]`; never recover a canonical path in Renderer. Store the identity as `mediaIdentity` on the inline image part. General attachment resolution compares its identity against image `mediaIdentity` values in the same turn; the inline image wins regardless of arrival order. This identity step handles Gateway URLs, `file://`, home-relative, relative-cwd, and equivalent absolute references.

- [ ] **Step 4: Project marked synthetic attachments**

Add this reducer helper:

```ts
export function upsertSyntheticTurnAttachments(
  snapshot: AcpTimelineSnapshot,
  input: {
    turnId: string;
    evidenceId: string;
    attachments: AttachmentRenderPart[];
    source: 'openclaw-media';
  },
): AcpTimelineSnapshot
```

Resolve candidates before final dedupe. Keep unavailable candidates patchable by the delayed retry. If a native ACP attachment later resolves to the same identity, remove the compatibility duplicate. If a compatibility inline image has the same identity, remove or reject the attachment card and preserve the inline image. Preserve native attachment source priority when no inline image exists.

- [ ] **Step 5: Wire historical and live timing in the store**

On existing `loadSession` success, start one supplement operation for the active session/generation. Replace the image-only transcript request with the shared coordinator.

On `sendPrompt` success:

- Capture current session, generation, and optimistic user message id.
- Run one immediate supplement restricted to that turn.
- Schedule one `setTimeout(..., 1500)` retry.
- Clear or invalidate the timer on session load, session switch, cancel, and a new prompt.

Every history response and every attachment resolution checks operation id and current state before timeline mutation.

- [ ] **Step 6: Add diagnostics and reason codes**

Record exact started/succeeded/failed events for transcript requests and reason-coded match/reject, resolution, dedupe, append, and stale-drop events. Store only source, counts, hashed evidence/identity, reason, session, and generation. Never record transcript content or full URI/path.

- [ ] **Step 7: Run compatibility and regression tests**

Run:

```bash
pnpm exec vitest run tests/unit/acp-media-attachments.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-trace.test.ts
pnpm run typecheck:web
```

Expected: all pass; one history call feeds both compatibility extractors and stale retries cannot append to another session.

- [ ] **Step 8: Commit OpenClaw compatibility projection**

```bash
git add src/lib/acp/openclaw-media-compat.ts src/lib/acp/transcript-supplement.ts src/lib/acp/attachments.ts src/lib/acp/reducer.ts src/lib/acp/image-generation-compat.ts src/stores/acp-chat-session.ts tests/unit/acp-media-attachments.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-trace.test.ts
git commit -m "feat: recover OpenClaw MEDIA attachments in ACP chat"
```

---

### Task 7: Electron Attachment End-To-End Coverage

**Files:**
- Create: `tests/e2e/chat-acp-attachments.spec.ts`
- Modify: `tests/e2e/fixtures/electron.ts`
- Modify: `tests/e2e/chat-run-state-events.spec.ts`
- Test: `tests/e2e/chat-acp-attachments.spec.ts`

**Interfaces:**
- Consumes: Complete attachment host, ACP timeline, transcript supplement, card, preview, and system-open behavior.
- Produces: Deterministic Electron evidence for live, historical, standard ACP, system-open, remote-open, and security behavior.

- [ ] **Step 1: Write and run the failing reported-flow E2E**

Write the `budget_sample.xlsx` scenario first against explicit planned fixture methods for ACP updates, transcript responses, temporary files, host-call recording, and retry timing.

Run:

```bash
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
```

Expected: compile or runtime failure because the dedicated controlled fixture methods are not implemented yet. Do not change product code to satisfy the fixture.

- [ ] **Step 2: Extend the controlled Electron fixture**

Add fixture hooks that can:

- Feed standard ACP session updates containing `resource_link`.
- Return controlled `sessions.history` transcript messages.
- Create temporary workspace and OpenClaw media files.
- Record `files.resolveAttachment`, `files.readAttachmentBinary`, `files.openAttachment`, `shell.openPath`, and `shell.openExternal` calls.
- Advance or wait for the exact 1500 ms retry without relying on a provider key.

Do not add direct Renderer IPC shortcuts; fixture overrides must operate at the existing typed host test seam.

Create a temporary default workspace with a valid `budget_sample.xlsx`. Feed ACP visible prose without a MEDIA line and transcript history containing:

```text
MEDIA:/absolute/test/workspace/budget_sample.xlsx
This is the budget_sample.xlsx file in the current directory.
```

Assert:

- The raw `MEDIA:` directive is absent.
- The prose appears before the paperclip attachment.
- Clicking the attachment opens the right Preview panel.
- The spreadsheet viewer reads through `files.readAttachmentBinary`.
- Switching away and back restores one deduplicated historical card.

- [ ] **Step 3: Cover standard ACP and non-preview routes**

Add deterministic cases for:

- Native ACP `resource_link` renders without transcript history and wins over duplicate transcript evidence.
- A ZIP attachment calls `files.openAttachment`, which delegates to system open in Main.
- An HTTPS attachment calls `files.openAttachment`, which delegates to external open in Main.
- An outside-workspace path renders unavailable and produces no read/open call.
- A stale delayed retry after session switch produces no card in the new session.
- An attachment emitted before a tool and later prose still renders after prose and before file activity.

- [ ] **Step 4: Run Electron E2E**

Run:

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts
```

Expected: all attachment scenarios pass on the Electron project; existing resource and generated-image cases remain green.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add tests/e2e/chat-acp-attachments.spec.ts tests/e2e/fixtures/electron.ts tests/e2e/chat-run-state-events.spec.ts
git commit -m "test: cover ACP media attachments end to end"
```

---

### Task 8: Durable Documentation And Full Validation

**Files:**
- Modify: `harness/reference/acp-chat.md`
- Modify: `harness/reference/acp-generated-media-and-diagnostics.md`
- Modify: `harness/reference/openclaw-file-activity.md`
- Modify: `harness/specs/tasks/acp-media-attachments.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/acp-compatibility-content-safety.md`
- Modify: `harness/specs/rules/tool-derived-file-safety.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Test: All focused tests named in Tasks 1-7

**Interfaces:**
- Consumes: Completed implementation and passing focused validation.
- Produces: Durable architecture record, synchronized user documentation, validated harness task, and final regression evidence.

- [ ] **Step 1: Update durable architecture references**

Document:

- Standard ACP resources remain preferred.
- OpenClaw ACP currently drops assistant media and strips live `MEDIA:` text.
- Transcript recovery is bounded to explicit assistant directives, remains in memory, and is removable when upstream emits resources.
- Main workspace grants and attachment operations are separate from incidental tool-derived file activity.
- All attachment reads and opens are session/generation scoped.
- Image-generation remains inline and only shares transcript coordination/identity helpers.

Ensure the code rationale comment added in Task 6 points at the final reference section.

- [ ] **Step 2: Synchronize README behavior**

Add concise ACP Chat attachment capability notes to all three READMEs. State that supported local files preview in-app, other authorized files open in the system application after user click, and remote HTTP/HTTPS attachments open externally. Do not expose internal path rules as user configuration unless a setting exists.

- [ ] **Step 3: Finalize the harness task tests and acceptance**

Update `requiredTests` in `harness/specs/tasks/acp-media-attachments.md` to exactly include the focused unit, E2E, typecheck, comms, and harness commands below. Ensure every acceptance item can be traced to a test or durable rule.

- [ ] **Step 4: Run complete focused validation**

Run:

```bash
pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/acp-session-access-registry.test.ts tests/unit/attachment-access.test.ts tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/acp-media-attachments.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-trace.test.ts tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/generated-files.test.ts tests/unit/media-api.test.ts tests/unit/files-api-workspace.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-acp-page.test.tsx
pnpm run typecheck
pnpm run lint:check
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/acp-media-attachments.md
pnpm harness run --spec harness/specs/tasks/acp-media-attachments.md
pnpm run harness:ci
```

Expected: every command exits zero; comms comparison reports no unapproved regression; the real task validates without `--no-diff`.

- [ ] **Step 5: Review the final diff for forbidden regressions**

Verify:

- No files under `~/workspace/openclaw` or `node_modules/openclaw` changed.
- No direct `window.electron.ipcRenderer.invoke` was added to pages/components.
- No Renderer Gateway fetch or WebSocket was added.
- No old `ChatMessage` or legacy `chat helpers` attachment path was reconnected.
- No raw transcript body or absolute path enters trace output.
- Every locale contains the same new keys.
- `git diff --check` passes.

- [ ] **Step 6: Commit documentation and validation metadata**

```bash
git add harness/reference/acp-chat.md harness/reference/acp-generated-media-and-diagnostics.md harness/reference/openclaw-file-activity.md harness/specs/tasks/acp-media-attachments.md harness/specs/scenarios/acp-chat-experience.md harness/specs/rules/acp-chat-state-and-history.md harness/specs/rules/acp-compatibility-content-safety.md harness/specs/rules/tool-derived-file-safety.md README.md README.zh-CN.md README.ja-JP.md
git commit -m "docs: document ACP attachment compatibility"
```
