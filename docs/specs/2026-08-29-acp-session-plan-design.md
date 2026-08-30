# ACP Session Plan Indicator Design

## Goal

Show the current OpenClaw `update_plan` TODO list above the chat composer for
the active ACP session. The indicator is read-only, initially collapsed, and
shows a `ListChecks` icon with completed and total task counts.

The feature must restore only from the existing ACP session history. It must
not add a ClawX persistence store, backend endpoint, IPC channel, or user
controls that modify the plan.

## Scope

Included:

- Derive one current plan from the active session's ACP timeline.
- Render a collapsible composer-adjacent plan pill and its task details.
- Restore the derived plan when ACP replays a session after switching sessions
  or restarting the app.
- Add localized UI strings for English, Chinese, Japanese, and Russian.
- Add unit, component, Electron E2E, and harness coverage for this ACP replay
  projection.

Excluded:

- Editing, completing, deleting, or otherwise writing plan steps from ClawX.
- Persisting plans outside OpenClaw's ACP/session history.
- Parsing unstructured assistant text or tool titles to reconstruct a plan.
- Changing OpenClaw's `update_plan` tool, ACP transport, or history format.

## Source Of Truth

OpenClaw validates `update_plan` calls as an ordered, non-empty `plan` array.
Each entry has a `step` string and one of `pending`, `in_progress`, or
`completed`; at most one entry is `in_progress`. Its ACP translator emits the
tool call with the structured arguments in `rawInput` and records the update
for session replay.

ClawX already stores this structured value as `ToolCallItem.input` in the ACP
timeline. The plan indicator derives its state exclusively from that field.

## Plan Selection

Introduce a pure ACP helper that accepts an `AcpTimelineSnapshot` and returns
either a validated current plan or `null`.

The helper walks `snapshot.itemOrder` from newest to oldest. A tool call is a
candidate only when all of the following are true:

- The item is a `tool-call` and identifies `update_plan` from its tool title.
- The item status is not `failed`.
- `item.input` is an object with a non-empty `plan` array.
- Every plan entry has a non-empty string `step` and a recognized status:
  `pending`, `in_progress`, or `completed`.
- At most one entry is `in_progress`.

The first candidate is the session's current plan. The helper exposes the
ordered steps, completed count, and total count. A running valid update is
shown immediately. If it later becomes failed, it no longer qualifies and the
previous valid plan becomes current. Missing, empty, malformed, or
unknown-status plan data is ignored.

The helper does not fall back to parsing the displayed tool title, tool output,
or assistant prose. This prevents ambiguous or stale plan reconstruction.

## Replay And Persistence Boundary

The active plan is recomputed from `visibleAcpTimeline` whenever the timeline
changes. It is scoped to the active ACP session and has no global cache.

When changing sessions, ClawX displays the plan derived from the newly loaded
session's timeline. When the user returns, the original session's plan appears
again if ACP replays its recorded `update_plan` call with `rawInput.plan`.

After an application restart, the same condition applies: the plan appears
only if OpenClaw supplies the structured tool-call history during session load.
If the event is unavailable, ClawX renders no plan rather than retaining or
inventing state. Deleting a conversation removes its transcript-backed evidence
and therefore removes its plan.

This is intentionally not a durable task manager independent from OpenClaw.
It is a projection of the latest recoverable plan in the current session.

## User Interface

Add a focused plan indicator component rendered within the existing `ChatInput`
container, above the existing working indicators, attachments, and composer
box.

Collapsed state:

- Render a keyboard-accessible button with the `ListChecks` icon and the
  localized completed/total count, for example `2 / 4`.
- Use the existing neutral pill styling while at least one step is unfinished.
- Use the existing success status token when all steps are completed.
- Start collapsed whenever the component mounts for a session, including after
  session changes, reloads, and app restarts.

Expanded state:

- Render a bounded-height, scrollable detail panel directly above the composer.
  It consumes layout space and never overlays the text field or transcript.
- Show all tasks in source order. Task text wraps instead of truncating.
- Completed tasks use a check icon and the localized completed label.
- The single in-progress task uses an active indicator and the localized
  running label.
- Pending tasks use a neutral circle and the localized pending label.
- Clicking the pill toggles the panel. The button exposes a localized accessible
  label and the correct `aria-expanded` state.

The expansion flag is transient component state. It is not placed in the ACP
store or any persistent store.

## Component Boundaries

- A new pure helper under `src/lib/acp/` owns plan input validation and latest
  plan selection. It has no React or UI dependencies.
- A new focused component under `src/pages/Chat/` renders the pill and details
  from the helper's normalized plan value.
- `src/pages/Chat/index.tsx` derives the plan from `visibleAcpTimeline` and
  passes the optional value to `ChatInput`.
- `src/pages/Chat/ChatInput.tsx` accepts the optional plan prop and positions
  the indicator before the existing composer UI.
- `shared/i18n/locales/{en,zh,ja,ru}/chat.json` contains all new display and
  accessibility strings. Existing ACP status translations are reused for task
  statuses.

No renderer-to-main calls are added. The renderer continues to consume the
existing typed ACP session store and host API path.

## Failure Handling

- No valid plan results in no pill and no placeholder.
- ACP session load failure follows the existing error banner behavior; the plan
  is not preserved from a previous session.
- A timeline replacement or clear immediately removes any previous plan.
- The plan remains readable from already loaded data if the gateway later becomes
  unavailable; it has no runtime request of its own.

## Validation

Unit coverage verifies:

- Valid structured plan extraction and completed/total counts.
- Newest valid plan selection across multiple assistant turns.
- Fallback after a newer plan call fails.
- Rejection of missing, empty, malformed, and unknown-status plan data.

Component coverage verifies:

- The pill is hidden with no valid plan.
- The pill is collapsed by default and toggles with mouse and keyboard.
- Task order, wrapping-capable markup, status icons, labels, and completion
  styling are correct.
- Replacing the plan or changing the session resets the UI to collapsed.

Electron E2E coverage verifies:

- A live `update_plan` produces the expected composer pill and expandable
  details.
- Switching away from a session and returning restores the plan through ACP
  history replay.
- Reload or relaunch restores the plan when the test ACP history fixture
  includes `rawInput.plan`.

The implementation updates the relevant ACP replay harness scenario and rule
specification. It also reviews `README.md`, `README.zh-CN.md`, and
`README.ja-JP.md`; documentation changes are made only when these user-facing
behavior details belong in the existing README scope.
