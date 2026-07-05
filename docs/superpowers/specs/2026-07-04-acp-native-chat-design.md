# ACP Native Chat Design

Date: 2026-07-04

## Summary

ClawX Chat should move from the current Gateway/ClawX-specific secondary Chat protocol to an ACP-native path. Electron Main owns the ACP stdio process and thin IPC envelope. The Renderer consumes raw ACP `session/update` notifications and reduces them into an in-memory view model for React rendering.

This design intentionally removes the old Chat protocol path without a feature flag or fallback. OpenClaw Gateway remains in use for non-Chat capabilities such as models, providers, plugins, skills, doctor, workspace, settings, and media configuration.

## Goals

- Use ACP as the Chat protocol boundary for the primary Chat path.
- Keep Main thin: process lifecycle, stdio transport, ACP SDK calls, and IPC routing only.
- Put Chat semantic reduction in Renderer, where UI iteration is cheaper and more direct.
- Avoid creating a second source of truth for history.
- Preserve existing user-visible Chat capabilities, including streamed assistant output, thinking, tools, permissions, attachments, generated images, markdown, and history replay.
- Add missing UI components when the ACP render model needs them.
- Render thinking, tool calls, permissions, plans, and media as natural inline timeline blocks instead of folding them into a separate Execution Graph.

## Non-Goals

- Do not introduce an AionUi-style secondary event protocol.
- Do not persist ClawX-owned Chat history, ACP ledger, replay log, or reduced timeline state.
- Do not fall back to the old Gateway Chat protocol for Chat history or live streaming.
- Do not make the Renderer talk directly to Gateway HTTP or WebSocket endpoints.
- Do not use optimistic user bubbles in the first implementation.
- Do not keep the current Execution Graph aggregation model for the ACP Chat path.

## Architecture

The target flow is:

```text
Renderer Chat page
  -> src/lib/host-api.ts
  -> Electron Main ACP service
  -> openclaw acp stdio process
  -> OpenClaw Gateway-backed ACP bridge
```

The data flow for updates is:

```text
ACP session/update
  -> Main envelope with sessionKey and generation
  -> Renderer ACP-native reducer
  -> ClawX ordered timeline render model
  -> React components
```

The `ClawX ordered timeline render model` is internal UI state. It is not a protocol, is not sent across process boundaries, and is not persisted. It should show text, thought, tool, permission, plan, and media blocks as sibling timeline items in the order ACP delivers them.

## Main Process Boundary

Add a thin Main service, expected path:

```text
electron/services/acp-chat-api.ts
```

Responsibilities:

- Start and reuse the `openclaw acp` child process.
- Initialize the ACP client over stdio.
- Expose typed host API operations for `session/load`, `session/prompt`, `session/cancel`, and permission responses.
- Subscribe to ACP `session/update` notifications.
- Forward notifications to Renderer with a small routing envelope.
- Track a per-session generation so stale updates from a previous selected session cannot mutate the active Renderer timeline.

Main must not:

- Translate ACP updates into `chat:message`, `chat:runtime-event`, or any other Chat-specific secondary event stream.
- Concatenate text, parse thinking, interpret tool semantics, or build UI timeline items.
- Persist ACP replay data, ledgers, transcripts, or reduced Chat state.
- Implement Chat protocol fallback to the old Gateway event path.

The event envelope should contain only routing and race-protection data:

```ts
type AcpSessionUpdateEnvelope = {
  sessionKey: string
  generation: number
  update: SessionNotification
}
```

## Host API Boundary

Renderer code must continue using `src/lib/host-api.ts` and `src/lib/api-client.ts` as the entry point for backend calls. New direct `window.electron.ipcRenderer.invoke(...)` calls should not be added to Chat pages or components.

Expected host API shape:

```ts
loadAcpChatSession(input: {
  sessionKey: string
  cwd: string
}): Promise<{ ok: true }>

sendAcpChatPrompt(input: {
  sessionKey: string
  cwd: string
  content: AcpPromptContent[]
}): Promise<{ ok: true }>

cancelAcpChatSession(input: {
  sessionKey: string
}): Promise<{ ok: true }>

respondAcpPermission(input: {
  sessionKey: string
  permissionId: string
  optionId: string
}): Promise<{ ok: true }>

subscribeAcpSessionUpdates(
  listener: (event: AcpSessionUpdateEnvelope) => void
): () => void
```

Exact ACP SDK types should be imported from the installed ACP package during implementation. If the SDK shape differs, keep the same ownership model and adapt only the type names.

## Session Identity And History

ClawX should use the OpenClaw Gateway session key as the ACP session id:

```text
ACP sessionId === OpenClaw Gateway sessionKey
```

Calls should also include `_meta.sessionKey` so the OpenClaw ACP bridge routes to the intended Gateway-backed session:

```ts
session/load({
  sessionId: sessionKey,
  cwd,
  mcpServers: [],
  _meta: {
    sessionKey,
    prefixCwd: false,
  },
})
```

`openclaw acp --session` can be used only as a bridge default routing seed. It must not become the source of truth for the active ClawX session.

History loading should use ACP `session/load` replay. ACP `session/resume` is not enough because it does not replay prior history. When `session/load` returns, replay is considered complete for that request.

ClawX must not write a local Chat history cache, ACP ledger, replay log, or transcript-derived reduced state. If ACP replay does not provide a historical detail, ClawX should not invent or recover that detail from separate local scanning.

## Renderer State And Reducer

Replace the monolithic Chat protocol interpretation path with focused Renderer modules:

```text
src/stores/acp-chat-session.ts
src/lib/acp/reducer.ts
src/lib/acp/timeline-types.ts
src/lib/acp/content-blocks.ts
```

`src/stores/acp-chat-session.ts` should hold active Chat session UI state, load/send/cancel state, and the current timeline snapshot. The reducer in `src/lib/acp/reducer.ts` should be a pure function so replay and streaming behavior can be unit tested without React or Electron.

Suggested snapshot shape:

```ts
type AcpTimelineSnapshot = {
  sessionId: string
  loadGeneration: number
  itemOrder: string[]
  itemsById: Record<string, TimelineItem>
  toolCallsById: Record<string, ToolCallItem>
  permissionRequestsById: Record<string, PermissionItem>
  planById: Record<string, PlanItem>
  metadata: AcpSessionMetadata
}
```

The snapshot is bounded in-memory state for the current active session. On session switch, increment generation, reset the current snapshot, call `session/load`, apply replay updates, then mark the load complete.

The reducer must switch on ACP-native `SessionUpdate` discriminators. It must not consume or emit AionUi protocol events such as `text`, `thinking`, `acp_tool_call`, or `acp_permission`. AionUi is useful only as a reference for idempotent merge strategy, especially merging by `messageId` and `toolCallId`.

`messageId` should be treated as an opaque runtime identifier. It can be used for in-memory merge keys during one loaded timeline, but it must not be treated as durable UI identity across loads.

UI-only state should stay outside the ACP reducer. Examples include tool card expansion, scroll pinning, selected artifact, composer draft, and lightbox state.

## Render Model

The Renderer should convert ACP content blocks into renderable parts before they reach React message components:

```ts
type RenderPart =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; source: string; mimeType?: string; alt?: string }
  | { kind: 'file'; path?: string; name?: string; mimeType?: string }
  | { kind: 'error'; message: string }
```

The timeline should be expressed as UI item kinds, for example:

```ts
type TimelineItem =
  | MessageSegmentItem
  | { kind: 'thought'; messageId: string; parts: RenderPart[] }
  | ToolCallItem
  | PermissionItem
  | PlanItem

type MessageSegmentItem = {
  kind: 'message-segment'
  id: string
  role: 'user' | 'assistant'
  messageId: string
  segmentIndex: number
  parts: RenderPart[]
}
```

These `kind` values are internal render model details, not a process boundary or persisted protocol.

## Timeline Ordering Instead Of Execution Graph

The ACP Chat path should not render the current `ExecutionGraphCard` aggregation model. Thinking, tool calls, permissions, plans, generated files, and generated images should appear as normal timeline blocks between message text segments.

The reducer should preserve first-seen ACP update order in `itemOrder`. Updates to an existing tool, permission, plan, or thought item should patch that item in place. New process blocks should be inserted at the current end of the timeline, unless ACP provides a stronger ordering primitive.

Assistant text must support segmentation. If text chunks for a `messageId` arrive continuously, append them to the current `message-segment`. If a thought, tool, permission, plan, or media block arrives after that text and later more text arrives for the same `messageId`, create a new `message-segment` with the same `messageId` and the next `segmentIndex`. This keeps flows such as `assistant text -> thought -> tool call -> assistant text` visually interleaved instead of moving all assistant text above or below the process blocks.

The same rule applies to replay and live streaming. A full ACP message update may replace the content of the currently open segment for that message when the SDK shape makes that replacement explicit. If the ordering is ambiguous, preserve the visible timeline order and create a later segment rather than reordering existing process blocks.

## Tools, Permissions, And Plans

Tool calls should render as separate inline timeline items rather than being embedded into an assistant bubble or folded into an execution graph:

```ts
type ToolCallItem = {
  kind: 'tool-call'
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  outputParts: RenderPart[]
  error?: string
}
```

ACP tool call creation should upsert the base item. Tool updates should patch status and metadata. Tool content chunks should append output parts. Replay and live streaming should use the same reducer path.

Permissions should also be separate inline timeline items:

```ts
type PermissionItem = {
  kind: 'permission'
  id: string
  toolCallId?: string
  title: string
  description?: string
  options: PermissionOption[]
  status: 'pending' | 'approved' | 'denied' | 'expired'
}
```

Permission button clicks should call the typed host API. Renderer must not call Gateway HTTP directly or implement transport fallback.

Plans should be represented as a dedicated `PlanItem` when ACP exposes plan updates. If ACP does not expose plan updates for a given session, no synthetic plan should be generated from unrelated events.

## Image And Media Handling

Image input should be sent as ACP image content blocks. Image generation should be rendered as ACP tool/media output rather than through the old Chat protocol:

```text
user image input
  -> ACP image content block

image_generate running
  -> tool-call item status running

generated image path, media block, or MEDIA reference
  -> RenderPart image
```

Gateway media configuration and diagnostics remain outside the Chat protocol migration. They continue to be managed through existing non-Chat Gateway capabilities.

If `session/load` replay does not include a historical generated image path or media block, ClawX should not scan local files or Gateway artifacts to backfill it. ACP replay remains the history source of truth.

## UI Components

Reuse existing Chat visual language where possible. Add missing components when the ACP render model requires them:

- `AcpToolCallCard`
- `AcpPermissionCard`
- `AcpImagePart`
- `AcpErrorBanner`
- `AcpPlanItem`
- `AcpThoughtBlock`

The existing execution graph UI should not be carried forward as the primary representation for ACP Chat process state. If any old components remain temporarily during migration, they should be isolated from the ACP path and removed once the old path is deleted.

All user-facing text must use `react-i18next` with `en`, `zh`, `ja`, and `ru` locale coverage. Styling should use the design tokens and substitution rules in `src/styles/globals.css`.

## Error Handling

Use two error surfaces:

- Session-level errors: ACP bridge startup failure, `session/load` failure, prompt failure, cancel failure, or permission response failure. These should render near the Chat header or composer as a banner.
- Timeline-level errors: tool failure, unsupported content block, media rendering failure, or message-specific error. These should render as timeline item error parts.

Session switch races should be handled by generation checks. If an update arrives with a stale generation, Renderer should ignore it.

## Migration Scope

Remove or stop using the old Chat main path:

- Renderer no longer uses `gateway:chat-message` or `chat:runtime-event` as Chat timeline sources.
- `src/stores/chat.ts` should be split or reduced so protocol interpretation moves to ACP-specific modules.
- Main no longer forwards Gateway Chat events to Renderer as the primary Chat path.
- Old Chat send/media status behavior in `electron/services/chat-api.ts` should be replaced by ACP prompt/tool/media rendering where it affects Chat.
- `ExecutionGraphCard` and `task-visualization` behavior should be removed from the ACP Chat path. Existing graph-focused tests should be replaced with inline timeline ordering tests.

Keep Gateway-backed non-Chat capabilities:

- models and providers
- plugins and skills
- doctor
- workspace and settings
- media configuration
- usage and diagnostics not tied to Chat streaming protocol

## Testing Strategy

Unit test the pure ACP reducer:

- replay and live update use the same reducer path
- message chunk merge
- message segmentation when process blocks interleave with text from the same `messageId`
- thought merge
- tool call creation, status patch, and content append
- permission item lifecycle
- image/media content conversion
- stale generation is ignored at the store boundary

Test the Main ACP service with a mocked ACP client or stdio transport:

- `session/load`, `session/prompt`, `session/cancel`, and permission response call arguments
- `_meta.sessionKey` and `sessionId` routing
- generation changes on session switch
- Main forwards raw ACP notifications without text/tool/thinking semantic translation

Test React rendering with view-model fixtures:

- assistant and user messages
- thought block
- tool card
- permission card
- image part
- error banner

Add or update Electron E2E coverage because this is a user-visible Chat flow change:

- opening a session loads ACP replay
- sending a prompt renders ACP updates
- inline thought/tool/process blocks preserve ACP order
- permission interaction basics when feasible
- image/media rendering basics when feasible

The user configured Playwright MCP/CDP access at `http://127.0.0.1:9223`. During implementation or debugging, ClawX can expose the Electron debugging port on 9223 so real UI behavior can be inspected through Playwright against the running app. The configured model for in-app testing is `glm-4.7`.

## Harness And Verification

Because implementation touches Renderer/Main/host-api/ACP/Gateway communication paths, implementation must start from a harness task spec under:

```text
harness/specs/tasks/acp-native-chat.md
```

That task spec should reference `gateway-backend-communication` and include relevant communication boundary rules. Before implementation review, run:

```text
pnpm harness validate --spec harness/specs/tasks/acp-native-chat.md
```

Validation should include, at minimum:

- `pnpm run typecheck`
- `pnpm test` or targeted Vitest suites
- relevant Playwright E2E tests
- `pnpm run comms:replay`
- `pnpm run comms:compare`

Use `pnpm harness run --spec harness/specs/tasks/acp-native-chat.md` or `--dry-run` when checking the selected validation flow.

## Documentation Impact

After implementation, review these files for required updates:

- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`

Update them if Chat architecture, debugging, or development workflow changes are user-visible or developer-visible.

## Acceptance Criteria

- Chat live streaming and history replay come from ACP `session/update` and `session/load`.
- Renderer consumes raw ACP notifications through a typed host API subscription and reduces them locally.
- Thinking, tool calls, permissions, plans, and media render as inline timeline blocks in ACP order, not as a folded execution graph.
- Main owns ACP stdio process lifecycle and IPC routing only.
- No AionUi-style secondary Chat protocol is introduced.
- No ClawX-owned Chat history, ACP ledger, replay log, or reduced timeline state is persisted.
- No direct Renderer Gateway HTTP/WebSocket Chat transport remains in the primary Chat path.
- Existing non-Chat Gateway capabilities continue to work.
- Missing ACP Chat UI components are implemented as needed with full i18n coverage.
- Unit, integration, and E2E coverage exist for the new Chat path.
