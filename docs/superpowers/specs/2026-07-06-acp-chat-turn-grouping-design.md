# ACP Chat Turn Grouping Design

Date: 2026-07-06

## Summary

This change fixes the next set of ACP Chat regressions found after the ACP-native Chat migration and the first polish pass. The work keeps ACP protocol state flat and faithful, then adds a renderer-only display grouping layer so assistant text and tool activity appear as one assistant turn in the UI.

The design also strengthens heartbeat session filtering at selection boundaries, adds delayed auto-collapse for completed tool cards, and clarifies how historical tool cards are rendered from OpenClaw `session/load` replay.

## Goals

- Prevent internal heartbeat-only sessions from being selected on startup or after Gateway restart.
- Keep heartbeat-only sessions out of the sidebar without hiding real user conversations named `ClawX`.
- Render `assistant text -> tool call -> assistant text` as one assistant turn with one Sparkles identity and one copy control.
- Nest ACP tool cards inside the assistant turn column instead of rendering them as full-width timeline siblings.
- Auto-collapse completed tool cards after a 1 second delay while preserving manual expand/collapse control.
- Render historical tool cards when ACP `session/load` replays `tool_call` and `tool_call_update` events.
- Avoid synthesizing historical tool cards when OpenClaw falls back to transcript-only replay.
- Cover user-visible behavior with Electron E2E tests and pure grouping/filtering behavior with unit tests.

## Non-Goals

- Do not persist a ClawX-local chat ledger, reduced timeline, replay cache, or historical tool-call reconstruction.
- Do not infer assistant/tool relationships from ACP fields that do not exist, such as `turnId`, `runId`, or `parentId`.
- Do not depend on `_meta` for required grouping semantics.
- Do not change Main-owned ACP process lifecycle, stdio transport, SDK calls, or IPC envelope behavior.
- Do not refactor the legacy Chat renderer into the ACP renderer as part of this change.
- Do not hide sessions only because their title or display name is `ClawX`.

## Considered Approaches

### Recommended: Renderer-Only Turn Grouping

Keep the ACP reducer output as a flat timeline, then derive display groups immediately before rendering. A display group is either a user message block or an assistant turn. An assistant turn contains all assistant-side items between two user messages, including assistant text segments, thoughts, and tools.

This approach is the smallest correct change. It avoids mixing UI grouping with protocol reduction and works for both live updates and replayed events.

### Rejected: Reducer-Owned Synthetic Turn IDs

The reducer could assign synthetic turn IDs while processing ACP events. This would make rendering simpler, but it would mix UI-only presentation state into the protocol reducer and increase risk around replay/live parity.

### Rejected: Persist ClawX-Local Reduced History

ClawX could persist a reduced timeline to make old history more deterministic. This conflicts with the current architecture boundary: OpenClaw `session/load` is the authority for history, and ClawX should not maintain a second chat history source.

## Heartbeat Session Selection

The existing heartbeat filter should be reused and strengthened so it applies at both rendering and selection boundaries.

A session may be treated as hidden only when it is a ClawX desktop/internal heartbeat session whose available preview or message content contains the exact sentinel `[OpenClaw heartbeat poll]` and there is no visible user conversation content. Title alone is never sufficient to hide a session.

On startup, current-session restoration should validate the selected session before rendering it. If the restored or default session is hidden by the heartbeat predicate, Chat should switch to the empty new-chat state instead of showing the heartbeat conversation.

After Gateway restart or sidebar refresh, if the current session becomes a hidden heartbeat session, the store should again move to the empty new-chat state. The sidebar should not reinsert that session as the selected current conversation.

This is a presentation and selection guard. It does not delete transcripts, alter OpenClaw heartbeat behavior, or mutate OpenClaw history.

## Assistant Turn Grouping

Add a pure grouping helper that consumes the current ACP timeline snapshot and returns display groups for `AcpTimeline`.

The grouping rule is sequential:

- A user message item starts or appends to a user display block.
- Assistant-side items are collected into the current assistant turn.
- A new user message closes the current assistant turn and starts the next user block.
- Consecutive assistant-side items between two user messages remain in the same assistant turn.

Assistant-side items include assistant message segments, thought segments, tool calls, and any related tool call content/update items already represented in the flat timeline.

The grouping helper must not use `messageId` or `toolCallId` to decide turn ownership. Those IDs identify protocol messages or tool calls, not the whole assistant turn. They may still be used for React keys and item identity.

## Assistant Turn Rendering

`AcpTimeline` should render grouped output instead of mapping flat timeline items directly to top-level siblings.

An assistant turn renders one assistant identity column with the Sparkles icon, one assistant content column, and one turn-level copy control. The turn-level copy action copies textual assistant content from all assistant text segments in the turn. Tool output is excluded from the assistant copy payload.

For `assistant text -> tool -> assistant text`, both assistant text segments should appear under the same Sparkles identity and copy affordance. The tool card appears between the two text segments inside the same assistant content column.

User message rendering should keep its current treatment, except for any small adapter changes needed to consume grouped data.

## Tool Cards

Tool cards should render inside assistant turns with assistant-column indentation, not full timeline width.

Tool output continues to use exact preformatted rendering so whitespace, indentation, tables, and logs remain visible. Long output may scroll within the card according to the existing polish behavior.

When a tool reaches a completed state, the card should auto-collapse after a 1 second delay. The delay should allow the user to see completion and should feel intentional rather than abrupt.

Manual user interaction overrides auto-collapse for that card. If the user expands or collapses the card, subsequent status changes should not immediately undo the explicit choice unless the same tool starts a new active lifecycle.

The collapse transition should be lightweight and CSS-based where practical. It should not add a new animation dependency.

## History Replay

ClawX should render whatever structured ACP events are replayed by OpenClaw `session/load`.

For ledger-backed sessions where OpenClaw replays `tool_call`, `tool_call_update`, and related events, historical tool cards should render the same way live tool cards render.

For transcript fallback sessions, OpenClaw only reconstructs user, assistant, and thought text chunks. ClawX should not synthesize historical tool cards from transcript text because the fallback does not contain enough structured tool-call information.

The user-visible implication is explicit: new ACP bridge sessions with complete event ledgers can show historical tool cards; older, no-ledger, or incomplete-ledger sessions may show only text and thought history.

## Data Flow And Boundaries

The renderer must continue to use `src/lib/host-api.ts` and `src/lib/api-client.ts` for backend calls. No direct renderer IPC calls or direct Gateway HTTP calls should be added.

ACP timeline reduction remains in-memory and renderer-owned. The new grouping helper derives display-only structure from existing timeline state. It should not become a persistence format or a replay source.

Main process behavior stays unchanged for this feature unless a minimal host-api route is already required by existing code paths. Transport policy remains Main-owned.

## Error Handling

Grouping should be tolerant of partial or unusual ACP timelines. If assistant-side items appear before any user item, they should form an assistant turn rather than being dropped.

Unknown item types should continue to follow the existing fallback behavior. This design should not make history replay fail because a future ACP item appears.

Heartbeat selection guards should fail open for real conversations. If metadata is insufficient to prove a session is heartbeat-only, the session should remain visible and selectable.

## Testing

Add unit tests for the pure grouping helper:

- `assistant text -> tool -> assistant text` produces one assistant turn.
- Two user messages split assistant turns at the user boundary.
- Assistant-side items before the first user message still render in an assistant turn.
- Grouping does not depend on `messageId`, `toolCallId`, or `_meta`.

Add or extend heartbeat filtering tests:

- Heartbeat-only ClawX desktop sessions are hidden.
- Real sessions titled `ClawX` remain visible.
- Startup or refresh selection of a hidden heartbeat session falls back to new-chat state.

Add or update Electron E2E coverage:

- A tool card renders inside an assistant turn rather than as a full-width sibling.
- `assistant text -> tool -> assistant text` shows one Sparkles identity and one assistant copy control.
- A completed tool card collapses after the 1 second delay.
- Manual expand/collapse overrides the auto-collapse state.
- Ledger-style replayed tool events render historical tool cards.
- Transcript fallback history does not fake tool cards.

## Documentation

Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation. This change is expected to require no README updates unless the visible history behavior needs a troubleshooting note about old transcript-only sessions lacking historical tool cards.

## Validation

Expected validation after implementation:

- `pnpm run typecheck`
- Targeted unit tests for ACP grouping and heartbeat selection guards
- Targeted Electron E2E specs covering the grouped ACP Chat timeline
- `pnpm run build:vite`

If implementation touches communication paths beyond renderer-side grouping and session selection guards, also run the comms replay/compare commands required by the repository checklist.
