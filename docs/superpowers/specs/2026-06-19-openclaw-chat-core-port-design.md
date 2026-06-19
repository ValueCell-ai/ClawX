# OpenClaw Chat Core Port Design

Date: 2026-06-19

## Summary

ClawX Chat will move from a ClawX-specific Gateway event adapter to an
OpenClaw Chat Core driven React surface. The first implementation phase will
vendor the relevant OpenClaw Web UI chat core code into ClawX, adapt it to the
Electron host API boundary, and replace the existing Chat page by default.

The goal is correctness first: eliminate duplicated optimistic user messages,
incorrect assistant terminal rendering, stale streaming state, and session/event
cross-contamination caused by maintaining a second ClawX-specific chat runtime
protocol.

This is not a visual port of OpenClaw Web UI. The Chat surface remains a ClawX
desktop UI and must continue to use ClawX design tokens, i18n, toolbar patterns,
artifact panel integration, and Electron Main/Renderer communication rules.

## Decisions

- Use option B: port OpenClaw Chat Core semantics and rebuild the core React
  Chat surface around that message model.
- Vendor OpenClaw chat core into ClawX for the first phase. Do not fork or modify
  OpenClaw upstream in the short term.
- Replace the current Chat implementation by default. Do not keep a long-lived
  feature flag or parallel route.
- Keep Renderer communication behind `hostApi` and host event subscriptions.
  Renderer must not directly connect to Gateway, call Gateway HTTP endpoints, or
  add direct `window.electron.ipcRenderer.invoke(...)` calls.
- Stop using ClawX `ChatRuntimeEvent` as the new Chat surface's primary runtime
  protocol. Main should forward upstream-shaped OpenClaw `agent` payloads through
  host-events so the vendored core can consume OpenClaw-style semantics.
- Keep the current ClawX attachment policy: images are sent as base64 media;
  non-image files are sent as path/text references.
- Keep the composer as a textarea with floating menus. Do not introduce Lexical.
- Do not implement realtime voice/talk in this project.
- Do not include pinned messages, deleted messages, full history search, or
  checkpoints in the first implementation phase.
- Defer canvas preview support. Tool card extraction should preserve extension
  points, but canvas rendering is not part of phase one.

## Goals

- Use OpenClaw Web UI's proven chat semantics for history loading, send
  idempotency, stream reconciliation, run lifecycle, tool streams, slash command
  execution, compaction, and approvals.
- Make the visible Chat UI a deterministic projection of history, live stream,
  optimistic sends, queued sends, tool stream state, and runtime indicators.
- Support a redesigned core Chat surface:
  - message groups
  - streaming assistant group
  - thinking blocks
  - tool cards
  - raw output panel
  - run status
  - send queue state
  - compaction/fallback status
  - exec/plugin approval prompt
- Preserve ClawX application shell behavior:
  - Electron Main owns transport
  - Renderer uses `hostApi`
  - existing toolbar and artifact panel concepts remain
  - i18n covers `en`, `zh`, `ja`, and `ru`
  - styling follows `src/styles/globals.css` design token rules
- Add Electron E2E coverage for user-visible Chat changes.
- Run communication validation for Gateway/chat path changes.

## Non-Goals

- Do not port OpenClaw Web UI's Lit templates or CSS wholesale.
- Do not turn ClawX into a browser Control UI.
- Do not add direct browser Gateway authentication in Renderer.
- Do not replace ClawX settings, sidebar, artifact panel, model picker, agent
  picker, or skill picker unless a narrow adapter is needed.
- Do not change OpenClaw upstream source as part of this design.

## Architecture

The implementation should be organized as four layers:

```text
Vendored OpenClaw chat core
  reducer / history / send / stream reconciliation / lifecycle / slash / tools
        |
ClawX host API adapter
  hostApi.gateway.rpc / hostApi.chat.sendWithMedia / sessions / approvals
        |
Thin Zustand binding
  snapshot / dispatch / host-event subscriptions / selectors
        |
React Chat surface
  message list / streaming group / tool cards / raw output / run status / composer
```

The core rule is that protocol and lifecycle semantics live in a framework-neutral
chat engine. Zustand is only the React binding layer. React components subscribe
through selectors and should not contain protocol reconciliation logic.

## Proposed File Layout

The exact names can be refined during implementation, but the design expects
these boundaries:

```text
src/chat-core/openclaw-port/
  state.ts
  reducer.ts
  actions.ts
  history.ts
  send.ts
  events.ts
  stream-reconciliation.ts
  run-lifecycle.ts
  slash-command-executor.ts
  tool-cards.ts
  selectors.ts

src/chat-core/clawx-adapter/
  client.ts
  attachments.ts
  host-events.ts
  session-routing.ts

src/stores/openclaw-chat-surface.ts

src/pages/Chat/
  ChatSurface.tsx
  MessageList.tsx
  MessageGroup.tsx
  StreamingGroup.tsx
  ToolCard.tsx
  RawOutputPanel.tsx
  RunStatusBar.tsx
  ApprovalPrompt.tsx
  ChatComposer.tsx
```

Vendored files should retain comments indicating their OpenClaw origin and the
local changes made for ClawX. Local React components should be ClawX-native and
should not import Lit.

## Main and Renderer Event Contract

Renderer still consumes events through host-events IPC. The change is the shape
of the Chat runtime event payload.

New Chat should consume upstream-shaped events:

```text
gateway:chat-event
gateway:agent-event
```

`gateway:chat-event` carries OpenClaw chat event payloads such as delta, final,
error, and aborted states.

`gateway:agent-event` carries OpenClaw agent event payloads without converting
them into ClawX-specific runtime events:

```ts
type GatewayAgentEventPayload = {
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  seq?: number;
  stream:
    | "lifecycle"
    | "assistant"
    | "thinking"
    | "tool"
    | "command_output"
    | "patch"
    | "approval"
    | "compaction"
    | "fallback"
    | string;
  data?: Record<string, unknown>;
};
```

Main process responsibilities:

- Receive Gateway events.
- Preserve upstream event semantics and fields as much as possible.
- Forward serializable payloads through host-events.
- Keep Gateway connection, RPC proxying, and process lifecycle ownership.
- Keep old `chat:runtime-event` only as a transition channel for existing code
  that still depends on it. The new Chat surface must not depend on it.

Renderer responsibilities:

- Subscribe to the upstream-shaped host events.
- Route events into the vendored chat core.
- Avoid creating another ClawX-specific runtime protocol.
- Keep UI components ignorant of raw Gateway payload details.

## Host API Adapter

The vendored core should talk to a small OpenClaw-style client interface:

```ts
type ChatCoreClient = {
  request<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
};
```

ClawX implementation:

```text
chat.history
  -> hostApi.gateway.rpc("chat.history", params, timeoutMs)

chat.send, text only
  -> hostApi.gateway.rpc("chat.send", params, 120000)

chat.send, staged media present
  -> hostApi.chat.sendWithMedia(...)

chat.abort
  -> hostApi.gateway.rpc("chat.abort", params)

sessions.compact
  -> hostApi.gateway.rpc("sessions.compact", params)

exec.approval.resolve
  -> hostApi.gateway.rpc("exec.approval.resolve", params)

plugin.approval.resolve
  -> hostApi.gateway.rpc("plugin.approval.resolve", params)
```

The adapter owns ClawX-specific attachment conversion and session routing. The
vendored core should receive normalized send inputs and should not know about
native file picker implementation details.

## State Model

The visible UI should be a selector output, not a direct render of history
messages. Conceptually:

```text
history messages
+ visible current assistant stream
+ live tool stream
+ pending optimistic user message
+ queued messages
+ runtime indicators
= visible chat items
```

The core state should track these categories:

```ts
type ChatSurfaceState = {
  sessionKey: string;
  selectedAgentId?: string;
  currentSessionId?: string;
  history: {
    messages: unknown[];
    loading: boolean;
    hasMore: boolean;
    requestVersion: number;
  };
  live: {
    runId: string | null;
    stream: string | null;
    streamSegments: Array<{ text: string; ts: number }>;
    toolMessages: unknown[];
  };
  send: {
    sending: boolean;
    queue: ChatQueueItem[];
    activeRunId: string | null;
    canAbort: boolean;
    lastError: string | null;
  };
  runtime: {
    runStatus: ChatRunUiStatus | null;
    compactionStatus: CompactionStatus | null;
    fallbackStatus: FallbackStatus | null;
    approvals: ApprovalRequest[];
  };
};
```

The implementation should prefer OpenClaw-origin types where practical. This
type sketch describes boundaries, not a new protocol to invent independently.

## Reconciliation Rules

The reducer and selectors must explicitly handle these cases:

- Optimistic user messages are replaced by matching transcript/history user
  messages when available.
- A single `runId` may produce at most one visible streaming assistant group.
- If history contains the terminal assistant for the active stream, the stream is
  no longer rendered separately.
- `tool_use` and `tool_result` content is rendered through tool cards or process
  blocks, not as stray assistant prose.
- `chat.send` ACK can arrive before or after the first delta.
- `chat.history` responses use request versions so stale loads cannot overwrite
  a newer session.
- Gateway events whose `sessionKey` or selected agent scope does not match the
  visible session do not pollute the current Chat surface.
- Recoverable send failures keep the queued item and enter waiting-reconnect
  state.
- Abort, error, and final events clear the correct run state without clearing
  unrelated session state.

## Send Reliability

The port should include OpenClaw-style handling for:

- idempotency keys
- duplicate submit prevention
- optimistic user message reconciliation
- delta-before-ACK preservation
- send queue state
- waiting-reconnect state
- recoverable timeout handling
- retry after reconnect
- terminal lifecycle reconciliation

This directly targets the current duplicated user query and stale terminal
assistant rendering failures.

## React Surface

The first React surface rebuild includes:

```text
ChatPage
  ChatToolbar
  ChatSurface
    RunStatusBar
    MessageList
      MessageGroup
      StreamingGroup
      ToolCard
      ThinkingBlock
      AttachmentBlock
    RawOutputPanel
    ApprovalPrompt
  ChatComposer
  ArtifactPanel
```

Preserve from current ClawX:

- page shell and navigation
- toolbar concepts
- artifact/generated files panel
- agent/model/skill picker concepts
- textarea composer base behavior
- staged file UX and attachment policy

Rebuild:

- message list projection
- message grouping
- streaming group rendering
- tool card rendering
- thinking block rendering
- raw output panel
- run status and queue display
- compaction/fallback display
- approval prompt
- slash menu behavior

## Slash Commands and Skills

The composer remains textarea-based. A floating slash menu should be implemented
with ClawX styling and i18n.

Phase one commands:

- `/help`
- `/new`
- `/reset`
- `/clear`
- `/compact`
- `/model`
- `/think`
- `/verbose`
- `/agents`
- `/skill`
- `/skills`

OpenClaw-origin command execution should be adapted through `ChatCoreClient`.
ClawX-specific `/skill` and `/skills` behavior should integrate with existing
skill discovery/display. At minimum, the UI must be able to list available
skills and insert the selected skill invocation into the composer.

## Tool Cards

Tool card behavior should come from OpenClaw tool extraction semantics where
possible, with React rendering:

- tool name
- status and error state
- arguments
- result preview
- raw output
- copy actions
- collapse/expand state

Canvas preview is excluded from phase one. The extraction layer may preserve
metadata that keeps future canvas support possible.

## Compaction, Fallback, and Approval

Compaction:

- `/compact` calls `sessions.compact`.
- `agent` compaction/fallback events update runtime indicators.
- History reload and stream reconciliation run after completion.

Approval:

- `exec.approval.requested` and `plugin.approval.requested` are routed into an
  approval queue.
- The UI presents the current approval with command/plugin context.
- Resolve actions call `exec.approval.resolve` or `plugin.approval.resolve`.
- Resolved or expired approvals disappear from the prompt.

Fallback:

- Upstream fallback events are surfaced as runtime indicators.
- Fallback indicators do not create normal assistant messages.

## Styling and i18n

- All new user-facing strings must use `react-i18next`.
- Locale coverage must include `en`, `zh`, `ja`, and `ru`.
- Use ClawX design tokens and substitution rules from `src/styles/globals.css`.
- Do not copy OpenClaw Web UI CSS class names as the visual contract.
- Cards should remain restrained and desktop-app appropriate.
- Avoid oversized marketing-style layouts in the Chat surface.
- Text must fit at mobile and desktop viewport sizes.

## Migration Plan

### Phase 1: Event Channels and Core Skeleton

- Add upstream-shaped Gateway `agent` event forwarding through Main/host-events.
- Add Renderer host event subscription for `gateway:agent-event`.
- Vendor the minimum chat core skeleton.
- Add the host API adapter.
- Keep existing Chat UI running during this internal setup.

Validation:

- Unit test Main-to-Renderer event forwarding.
- Unit test adapter request routing.
- Run communication validation:
  - `pnpm run comms:replay`
  - `pnpm run comms:compare`

### Phase 2: History, Send, and Stream Reconciliation

- Connect `chat.history`, `chat.send`, and `chat.abort`.
- Add idempotent send queue and recoverable failure handling.
- Generate visible chat items from history plus live stream.
- Replace the Chat page's primary message source with the new surface store.

Validation:

- Optimistic user message is not duplicated after history reload.
- Delta-before-ACK does not drop content.
- Final assistant history replaces live stream.
- Stale history response cannot overwrite a newly selected session.
- Basic Electron E2E for send, stream, final, history reload, and abort.

### Phase 3: Core React Surface

- Rebuild MessageList, MessageGroup, StreamingGroup, ThinkingBlock, ToolCard,
  RawOutputPanel, RunStatusBar, and ApprovalPrompt.
- Preserve toolbar/composer/artifact shell integrations.
- Connect generated file discovery to the new message/tool selectors.

Validation:

- Tool calls render as tool cards, not stray assistant process messages.
- Raw output can open, copy, and close.
- Markdown, math, images, and attachments still render.
- Electron E2E covers tool rendering and raw output panel.

### Phase 4: Slash, Compaction, Fallback, and Approval

- Add slash menu and command execution.
- Add `/skill` and `/skills`.
- Add compaction status and `/compact`.
- Add exec/plugin approval prompt and resolve actions.
- Add fallback status display.

Validation:

- `/compact` triggers compaction and reconciles history after completion.
- Approval requested events show a prompt and resolve correctly.
- Slash skill list displays available skills and inserts a selected skill.
- Reconnect state can flush queued sends without duplicates.

### Phase 5: Remove Old Chat Main Path

- Stop using ClawX `ChatRuntimeEvent` in the Chat surface.
- Remove or isolate obsolete Chat store paths.
- Keep reusable helpers that other pages still need.
- Update relevant documentation and harness specs.

Validation:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- Relevant Electron E2E specs
- i18n coverage for new strings

## Test Strategy

Unit tests:

- reducer actions
- stream reconciliation
- optimistic/history merge
- stale history request versioning
- send queue and retry state
- event routing for upstream-shaped `agent` events
- slash command adapter calls
- tool card extraction
- approval queue handling

Integration tests:

- host API adapter request mapping
- Main event forwarding contract
- Renderer host event binding
- generated visible items from mixed history/live/tool events

Electron E2E:

- send message and receive streaming response
- reload history without duplicate user message
- final assistant clears streaming group
- abort active run
- render tool call and raw output
- compaction command/status
- approval request/resolve
- attachment send with image and path reference

Communication validation:

- Required because the design touches renderer/Main/host-api/api-client/Gateway
  runtime paths.
- Run `pnpm run comms:replay` and `pnpm run comms:compare` before merging.
- Add or update harness task/rule specs that cover this communication path.

## Risks and Mitigations

Risk: vendored OpenClaw code drifts from upstream.

Mitigation: keep a clear vendor directory, retain source comments, keep local
changes isolated in adapters, and add tests around expected upstream semantics.

Risk: replacing Chat by default creates regression risk.

Mitigation: implement in phases, keep existing UI alive until the new source is
ready, and require E2E coverage before deleting the old main path.

Risk: raw upstream event payloads are wider and less typed than ClawX events.

Mitigation: confine payload parsing to the chat core adapter and keep React
components typed against selector outputs.

Risk: Zustand becomes another large business-logic store.

Mitigation: keep protocol logic in pure core modules, use Zustand only for
snapshot storage, dispatch, subscriptions, and selectors.

Risk: performance regressions from token streaming.

Mitigation: use selector-driven subscriptions, keep message windows bounded, and
avoid having the full Chat page subscribe to every state field.

## Success Criteria

- The same user prompt is not rendered twice after history reconciliation.
- The final assistant answer is not left as a process/streaming message after the
  run is complete.
- Tool use and tool results render as structured tool cards.
- `chat.send` ACK/delta ordering races do not lose content.
- Slow history responses do not overwrite a different selected session.
- Gateway disconnect/reconnect does not duplicate submitted prompts.
- Abort, error, and final events produce correct terminal run status.
- Compaction, fallback, and approval states match OpenClaw Web UI semantics.
- Renderer stays behind `hostApi` and host-events.
- The Chat surface visually matches ClawX rather than OpenClaw Web UI.
