# ACP Chat Polish Design

Date: 2026-07-05

## Summary

This change polishes the ACP Chat experience after the ACP-native migration and fixes two regressions discovered during interactive use: the initial session load error and an internal heartbeat-only `ClawX` session appearing in the sidebar.

The design is intentionally targeted. It does not refactor the legacy Chat renderer into the ACP renderer, does not alter ACP process ownership, and does not add persisted Chat history. It improves ACP UI affordances, preserves tool output formatting, makes run state clearer, and filters internal sessions from normal conversation navigation.

## Goals

- Restore assistant message affordances that existed in the legacy Chat UI: Sparkles identity and hover-to-copy.
- Render ACP tool output as exact preformatted text so newlines, spacing, indentation, tables, and logs remain visible.
- Show a lightweight AI working indicator above the composer only while the Stop-button sending state is active.
- Prevent recoverable initial ACP session-load failures from taking over the new-chat page.
- Hide heartbeat-only internal `ClawX` sessions from the sidebar without hiding real user conversations.
- Cover user-visible UI changes with Electron E2E tests and targeted unit tests where logic is pure.

## Non-Goals

- Do not introduce a second Chat protocol, ACP ledger, replay cache, or persisted reduced timeline.
- Do not refactor legacy `ChatMessage` and ACP message rendering into a shared component layer in this change.
- Do not change Main-owned ACP transport, stdio lifecycle, or the renderer/Main API boundary.
- Do not add broad typed session metadata unless needed to solve the heartbeat filtering regression.
- Do not hide sessions merely because their display title is `ClawX`; only heartbeat/internal-only sessions should be suppressed.

## Approach

Use targeted ACP UI and filtering changes.

The ACP renderer should own the new assistant visuals because it already owns the ACP timeline render model. Legacy `ChatMessage` remains a reference for interaction behavior, but this change should copy the smallest useful pattern rather than extracting shared abstractions.

Session filtering should remain conservative. A real user conversation must stay visible even if its title is `ClawX`. The filter should identify internal heartbeat-only sessions through stable content/session-key signals already available to the sidebar path, not through title alone.

## Assistant Message UI

ACP assistant message segments should render with a Sparkles avatar/icon aligned to the assistant bubble, matching the existing ClawX visual language. User message segments keep the current user-side treatment.

Assistant segments should expose a hover copy action. The action copies the assistant segment text content, including markdown text, while ignoring non-text render parts that cannot be represented on the clipboard. After a successful copy, the UI should briefly show a copied state. Copy controls should be keyboard/focus accessible, not pointer-only.

User-facing strings for the copy action and copied state must go through `react-i18next` with full locale coverage.

## Tool Output Formatting

ACP tool output should render as exact preformatted content.

The tool card should preserve whitespace and line breaks with code-like text treatment and safe overflow behavior. Long lines may scroll horizontally inside the output area rather than being reflowed into misleading text. This applies to tool output text that currently collapses through markdown paragraph rendering.

Tool cards should continue to render structured markdown or media parts elsewhere when ACP provides those as distinct render parts. The preformatted rule is for tool output text where exact terminal/log formatting matters.

## Working Indicator

Show a thin animated loading rail above the Chat input while the composer is in the same sending state that enables the Stop button.

The animation should be CSS-only to avoid adding a dependency for this small effect. It should visually move left-right-left, remain subtle, and disappear when sending/cancelling finishes. It should not appear during idle loads, failed loads, or when only historical replay is being rendered.

The indicator text, if any is visible to users or screen readers, must be localized.

## Initial Load Error Handling

The new-chat page should recover cleanly when the initial ACP load path fails with a transient IPC-style error such as `Error invoking remote method 'host:invoke': reply was never sent`.

For a blank or newly-created Chat view with no meaningful loaded timeline, a recoverable load failure should leave the user in an interactive new-chat state instead of showing a blocking session-load failure banner/page. Non-recoverable failures for an existing selected session can still surface through the existing error UI.

The implementation should avoid swallowing send failures. Errors during prompt submission should remain visible because the user action failed.

## Sidebar Heartbeat Session Filtering

The sidebar should not show internal heartbeat-only sessions created by OpenClaw background polling. The observed symptom is a fixed `ClawX` session whose content contains `[OpenClaw heartbeat poll]`.

Filtering should use the existing sidebar/session store path and should be narrow enough to avoid hiding legitimate conversations. A session may be hidden only when its available sidebar metadata or preview content contains the heartbeat sentinel `[OpenClaw heartbeat poll]` and the same session has no visible user-authored conversation content. Title alone must never hide a session.

This is a renderer/sidebar presentation filter. It does not delete transcript files, alter OpenClaw history, or change heartbeat behavior in OpenClaw.

## Data Flow And Boundaries

The renderer must continue using `src/lib/host-api.ts` and `src/lib/api-client.ts` for backend calls. No new direct renderer IPC calls or direct Gateway HTTP calls should be added.

ACP timeline reduction remains in-memory and renderer-owned. The UI polish should consume existing ACP timeline items and render parts. It should not add persistence or a new replay source.

## Testing

Add or update Electron E2E coverage for user-visible ACP Chat changes:

- Assistant ACP message shows the Sparkles identity and copy control on hover/focus.
- Copying an assistant ACP message writes the expected text and shows copied feedback.
- Tool output preserves newlines and indentation in the rendered card.
- The loading rail appears only while sending/Stop is active and disappears afterward.
- A recoverable initial load failure does not block a blank new-chat page.
- Heartbeat-only `ClawX` sessions do not appear in the sidebar, while normal conversations still do.

Add targeted unit tests for pure filtering or formatting helpers if the implementation introduces them. Existing ACP reducer tests should only change if timeline data shape needs a small UI-facing addition.

## Documentation

Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation. This polish is expected to require no README changes unless the visible Chat behavior or troubleshooting guidance changes beyond the current UI fixes.

## Validation

Expected validation after implementation:

- `pnpm run typecheck`
- Targeted unit tests for changed helpers/stores
- Targeted Electron E2E specs covering ACP Chat UI polish and sidebar filtering
- `pnpm run build:vite`

If implementation touches communication paths beyond recoverable error handling, also run the comms replay/compare commands required by the repository checklist.
