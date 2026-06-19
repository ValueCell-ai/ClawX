# OpenClaw Chat P0/P1 Parity Design

Date: 2026-06-20

## Context

ClawX is an Electron wrapper GUI for OpenClaw. The Chat UI must keep using the
existing Main/Renderer IPC path through `hostApi` and `api-client`; Renderer code
must not connect to the Gateway directly.

The current OpenClaw chat core port receives raw Gateway agent payloads, but its
Renderer core still models live output too narrowly: a single assistant stream
string, simple history/queue/stream concatenation, and approval request/resolved
states. This leaves important OpenClaw Web UI semantics under-modeled, including
thinking output, assistant phases, live tool events, command output, patch
summaries, terminal lifecycle metadata, and stable stream/tool interleaving.

This design fills P0 and P1 protocol/rendering gaps while preserving ClawX's
current visual system and Electron integration.

## Goals

- Render OpenClaw assistant output with phase-aware semantics.
- Distinguish thinking/reasoning from normal assistant replies.
- Render live tool calls as tool cards before history polling catches up.
- Preserve correct ordering among user messages, streaming assistant text, tool
  cards, command output, patch summaries, approvals, and terminal lifecycle
  events.
- Stop relying on ClawX's former secondary event protocol for Chat UI behavior.
- Keep ClawX's current UI style, component surfaces, IPC boundaries, and
  attachment sending semantics.

## Non-Goals

- Do not fork OpenClaw.
- Do not restore the old execution graph UI.
- Do not implement canvas preview or checkpoint browsing.
- Do not implement audio or voice rendering.
- Do not support OpenClaw `item` or `plan` streams in this iteration.
- Do not add direct Renderer-to-Gateway calls.
- Do not reintroduce a ClawX-specific secondary chat event protocol.

## Recommended Approach

Use an OpenClaw-semantics core with a ClawX renderer:

1. Main continues to dispatch raw agent payloads to Renderer.
2. `actionsFromAgentEvent` maps raw OpenClaw streams into semantic core actions.
3. `chatCoreReducer` stores structured live run state.
4. `selectVisibleChatItems` builds stable visible items from history, queue, live
   assistant segments, live thinking, live tools, runtime status, and approvals.
5. Existing ClawX components render those items using the current design system.

This keeps protocol correctness in the chat core, while React components remain
thin rendering surfaces.

## P0 Data Model

Extend `ChatCoreState.live` from a single assistant stream into structured run
state:

- `assistantSegments`: timestamped assistant text segments with `phase`,
  `replace/append` behavior, and optional `mediaUrls`.
- `currentAssistant`: the current in-progress assistant text for the active run.
- `thinkingSegments`: timestamped thinking/reasoning text segments.
- `currentThinking`: the current in-progress thinking text for the active run.
- `toolStreamById`: live tool entries keyed by `toolCallId`.
- `toolStreamOrder`: stable order of live tool calls.
- `commandOutputs`: command output entries keyed by `toolCallId`, `itemId`, or a
  generated event key.
- `patchSummaries`: patch summary entries keyed by `toolCallId`, `itemId`, or a
  generated event key.

Extend `ChatRunUiStatus` with terminal metadata:

- `endedAt`
- `stopReason`
- `livenessState`
- `replayInvalid`

Keep approval state structured by stable ids:

- `approvalId`
- `approvalSlug`
- `itemId`
- `toolCallId`
- local fallback id

## P0 Event Mapping

`stream=assistant`

- Read `text`, `delta`, `replace`, `phase`, and `mediaUrls`.
- Normalize phase as `final_answer`, `commentary`, or legacy.
- Write to assistant live state only.
- Do not merge commentary into final answer text.

`stream=thinking`

- Read `text` or `delta`.
- Write to thinking live state.
- Render separately from assistant final text.

`stream=tool`

- On `phase=start`, create a running tool card with name and args summary.
- On `phase=update`, update partial output.
- On `phase=result` or `phase=end`, complete the card with output, preview, and
  error state.
- When a new tool starts, commit any current assistant text into an assistant
  segment so text that preceded the tool stays above the tool card.

`stream=lifecycle`

- `start` sets the run to running.
- `completed`, `done`, `finished`, and `end` set the run to done and clear live
  state after history can replace transient items.
- `error` and `failed` set the run to error.
- `aborted` and `cancelled` set the run to interrupted, restore Send, and do not
  leave the session running.
- Preserve `endedAt`, `stopReason`, `livenessState`, and `replayInvalid`.

## P0 Visible Items

`selectVisibleChatItems` becomes a build pipeline similar in responsibility to
OpenClaw Web UI's `buildChatItems`, but it emits ClawX `VisibleChatItem` values.

Pipeline:

1. Normalize and filter history.
2. Hide heartbeat acknowledgements, `NO_REPLY`, and pure internal runtime
   prompts.
3. Extract assistant visible text by preferring `final_answer` over legacy
   unphased text.
4. Extract thinking blocks from `content[].type === "thinking"` and legacy
   `<think>` tags.
5. Preserve current user message and attachment echo deduplication.
6. Convert queued sends into normal user message items while hiding them once a
   matching history message exists.
7. Insert live assistant segments, live thinking, live tool cards, command
   output, and patch summaries.
8. Sort by visible timestamp with stable tie-breaking.
9. Collapse sequential duplicate display signatures.

Visible item kinds:

- `message`
- `stream`
- `thinking`
- `tool`
- `command`
- `patch`
- `approval`
- `runtime`
- `status`

`status` is reserved for visible errors or exceptional terminal states. Running
state is not rendered as a full-width chat item.

## P0 Rendering

Assistant messages and assistant streams use the existing `ChatMessage` surface
so Markdown, Sparkle avatar, copy button, and reply timestamp stay consistent.

Thinking is rendered as a muted, collapsible reasoning block near the associated
assistant/tool sequence. It is not merged into the final assistant reply.

Live tool events render through the existing ClawX tool card style. The card
uses a fixed default width of 50 percent of the chat viewport, with responsive
constraints for narrow windows.

The running indicator is not part of the message stream. It appears at the top
left of the composer area, directly above the input field, with a breathing
indicator and the label `AI 回复中`.

## P1 Event Coverage

`stream=command_output`

- Associate with an existing tool card by `toolCallId` or `itemId` when possible.
- If no tool association exists, render as an independent command card.
- Show title/name, cwd, status, exit code, duration, and output summary.
- Do not restore a raw output panel.

`stream=patch`

- Associate with an existing tool card by `toolCallId` or `itemId` when possible.
- If no tool association exists, render as an independent patch summary card.
- Show title/name, summary, added, modified, and deleted counts.
- Do not restore the execution graph.

`stream=approval`

- Treat approval events as upserts keyed by approval id candidates.
- Support `pending`, `approved`, `denied`, `failed`, and `unavailable`.
- Remove resolved cards from the pending list.
- Retain recent resolved ids in reducer state to prevent duplicate cards.

Assistant `mediaUrls`

- Attach live assistant `mediaUrls` to stream items.
- During live streaming, preview image-like URLs when safe.
- Let history reload provide complete file/path semantics for non-image media.

Heartbeat filtering

- Filter `HEARTBEAT_OK`, `NO_REPLY`, and pure heartbeat ack messages from both
  history and live output.
- Do not treat thinking/reasoning blocks as visible heartbeat content.

Compaction and `session.operation`

- Handle `stream=compaction` and `session.operation` with `operation=compact`
  through the same `CompactionStatus`.
- Support active, retrying, complete, and error phases.
- Render as lightweight runtime state near the composer, not as a full chat row.
- Do not add checkpoint browsing in this iteration.

## Component Boundaries

- `events.ts`: raw OpenClaw event to semantic core action mapping.
- `reducer.ts`: state transitions and dedup/upsert behavior.
- `selectors.ts`: visible item construction, filtering, ordering, and duplicate
  collapse.
- `history.ts` or a new extractor module: assistant phase extraction, thinking
  extraction, heartbeat filtering, and display text sanitization.
- `ToolCard.tsx`: shared rendering for history and live tool cards.
- New lightweight cards may be added for thinking, command output, and patch
  summaries when existing components cannot represent them cleanly.
- `ChatMessage` remains the normal assistant/user message renderer.

## Error Handling

- Unknown stream types are retained in `agent.event` for diagnostics but do not
  render visible UI.
- Malformed tool or approval events are ignored unless enough ids exist to
  produce a stable card.
- Terminal lifecycle events always clear abortable/sending state for the active
  run.
- If history reload arrives after live streaming, persisted messages replace
  transient live items through duplicate and timestamp reconciliation.
- Approval resolution failures surface through existing run error or approval
  card error paths.

## Tests

Unit coverage:

- `actionsFromAgentEvent` for assistant phases, thinking, tool start/update/end,
  command output, patch, lifecycle terminal phases, and approval upsert inputs.
- Reducer coverage for live assistant/tool interleaving, terminal cleanup,
  aborted/cancelled state, approval deduplication, and queued send replacement.
- Selector coverage for final answer priority, commentary suppression, thinking
  extraction, heartbeat filtering, timestamp sorting, and duplicate collapse.

Electron E2E coverage:

- Streaming assistant output remains after the user prompt and renders Markdown.
- Thinking appears as a separate reasoning block.
- Tool start/update/result renders live tool cards.
- Command output and patch summary render without raw output controls.
- Approval cards upsert and resolve without duplication.
- Abort/stop restores Send and clears running state.
- Heartbeat ack messages do not appear in the chat log.
- The running indicator appears at the composer top-left with `AI 回复中`.

Manual validation:

- Re-run the P0/P1 parts of the existing 33-item manual plan.
- Include normal chat, thinking model output, file read/write tools, shell command
  output, patch application, approval allow/deny, stop/abort, history reload, and
  Gateway restart.

Required commands after implementation:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts tests/unit/chat-input.test.tsx
pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
pnpm run typecheck
pnpm run lint
pnpm run comms:replay
pnpm run comms:compare
```

## Acceptance Criteria

- User prompts do not duplicate.
- Streaming assistant text stays after the corresponding user prompt.
- Final assistant answers are not rendered as process/running messages.
- Thinking is distinguishable from normal assistant replies.
- Live tool calls, command output, patch summaries, approvals, compaction, and
  fallback states have visible, testable paths.
- Stop/abort and terminal lifecycle events never leave the session stuck running.
- Renderer continues to use `hostApi`/`api-client` and does not call Gateway
  endpoints directly.
- ClawX visual style remains consistent with the current Chat UI.
