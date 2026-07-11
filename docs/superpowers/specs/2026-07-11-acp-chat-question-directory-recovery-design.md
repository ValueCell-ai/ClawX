# ACP Chat Question Directory Recovery Design

## Context

The legacy Chat page exposed a Question Directory in the toolbar. It listed
each real user question and smoothly scrolled the active chat pane to the
selected message. During the ACP timeline migration, `ChatToolbar` retained
the button but `Chat` stopped providing its items, state, and toggle callback.
The existing ACP-specific tests consequently assert that the button is
disabled.

## Goal

Restore the Question Directory for ACP Chat without reviving the legacy chat
renderer or deriving state from legacy Gateway messages.

## Non-Goals

- Do not change ACP reducer or subscription behavior.
- Do not include tool calls, thoughts, permission cards, or assistant messages
  in the directory.
- Do not persist directory state outside the active Chat page.

## Design

`Chat` derives directory items from the active `AcpTimelineSnapshot`. Each
`message-segment` with `role: 'user'` becomes one item, ordered according to
`itemOrder`. An item contains the ACP timeline item's stable id, its ordinal,
and a display title.

The title is built from the first non-empty markdown render part: whitespace is
normalized and text is truncated to the existing short-title limit. A user
message with no markdown text uses the existing localized fallback title.

Each user `AcpMessageSegment` receives an HTML anchor id derived from its
timeline item id. The Question Directory uses this anchor to call
`scrollIntoView({ behavior: 'smooth', block: 'start' })`, which scrolls the
existing chat scroll container through normal browser behavior.

`Chat` owns the open state and passes it, the derived count, and a toggle
callback to `ChatToolbar`. The toolbar remains disabled for zero or one user
message. When open, the directory renders in the existing desktop right-side
position, retains its 300-item rendering cap and hidden-count hint, and closes
naturally when changing to another session because the active timeline changes.

## Error Handling

- Empty timelines and a single user message keep the toolbar control disabled.
- Missing or non-markdown user content receives a localized fallback title.
- Missing anchor elements make a directory click a safe no-op.

## Testing

- Update the unit test to expect an enabled ACP directory for two user message
  segments, including repeated question text.
- Verify a directory click invokes smooth scrolling for the matching ACP user
  message anchor.
- Update the Electron E2E coverage to open the directory from ACP history and
  navigate to the selected user message.

## Acceptance Criteria

- ACP Chat lists every user message as a separate directory item, including
  duplicate text.
- The toolbar enables only when the active ACP timeline contains at least two
  user messages.
- Selecting an item smoothly scrolls to its corresponding user message bubble.
- Non-user ACP timeline entries never appear in the directory.
