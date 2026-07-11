# ACP Working Directory Title Normalization Design

Date: 2026-07-11

## Summary

ClawX must keep OpenClaw ACP working-directory prompt injection enabled while preventing its transport prefix from becoming an automatic conversation title. Only automatic title sources are normalized. User-entered session labels bypass ACP-prefix normalization while retaining existing validation and trim behavior.

## Root Cause

ClawX sends ACP session and prompt metadata with `prefixCwd: true`. OpenClaw's ACP bridge also defaults this setting to true and persists each prompt as:

```text
[Working directory: <cwd>]

<user prompt>
```

The ACP timeline displays the original prompt blocks sent by ClawX, so its user bubble correctly contains only `<user prompt>`. Sidebar labels instead use persisted data through three paths:

- `sessions.list` returns OpenClaw `derivedTitle`, derived from the persisted first user message.
- The Main-process session summary reads `firstUserText` from the transcript.
- History loading uses the first persisted user message as a fallback label.

Each path can therefore expose the persisted ACP prefix even though the chat bubble does not.

## Decision

- Retain explicit `prefixCwd: true` in `electron/services/acp-chat-service.ts`.
- Do not modify OpenClaw, its persisted transcript, ACP prompt blocks, or ACP timeline rendering.
- Normalize only automatic title candidates by removing one leading OpenClaw `[Working directory: ...]` line and its following whitespace.
- Remove a later working-directory envelope only when existing metadata cleanup exposes it as a leading transport prefix; preserve all other non-leading occurrences.
- Do not normalize explicit OpenClaw session `label` values, which include user renames.

Keeping `prefixCwd: true` preserves the current, intentional runtime behavior even if an upstream default changes. The title fix is independent of that protocol setting.

## Data Flow

1. ClawX sends a user prompt and retains the original text for the ACP timeline.
2. OpenClaw injects the working-directory prefix before sending and persisting the Gateway message.
3. When ClawX derives a sidebar title, it normalizes the automatic source text before truncation.
4. A manual `label` remains highest priority and bypasses normalization.

## Implementation

- Add a shared pure helper for stripping only the leading OpenClaw working-directory prefix. It must preserve ordinary text and any non-leading occurrence.
- In `electron/services/sessions-api.ts`, normalize transcript `firstUserText` before returning the session summary.
- In `src/stores/chat.ts`, use normalized text for `derivedTitle`, session-summary titles, and history fallback titles. Keep explicit `label` handling unchanged.
- Update the existing workspace harness task specification to record that automatic titles omit OpenClaw's transport prefix while ACP cwd injection remains enabled.

## Testing

- Unit-test the shared helper with prefixed, unprefixed, and non-leading marker text.
- Extend title hydration coverage for both a Gateway `derivedTitle` and host session summary containing the prefix.
- Extend `tests/e2e/chat-workspace-context.spec.ts` to confirm the sidebar title shows the user prompt without the prefix while the workspace remains bound to the same cwd.
- Keep existing ACP service coverage asserting `prefixCwd: true`.

## Truncated Gateway Titles

OpenClaw can truncate `derivedTitle` before ClawX receives it. When the injected cwd envelope alone exhausts that limit, the resulting title has the exact form `[Working directory: <cwd>]…` and contains none of the user's prompt. Removing the envelope from that value leaves a misleading standalone ellipsis.

- Treat only that exact automatic-title shape as missing, rather than displaying or caching `…`.
- Treat the truncated derived title as absent for session-summary hydration so Main-process `firstUserText` can supply the actual first prompt.
- Do not apply this rule to explicit `session.label` values or to other user-authored text that happens to include an ellipsis.

The regression fixture uses the reproduced `~/workspace/clawx-playground` shape: Gateway returns `[Working directory: ~/workspace/clawx-playground]…`, while the Main summary returns `当前目录有什么文件？解释。`.

## Documentation And Validation

- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; no update is expected unless they document automatic title derivation.
- Run the relevant harness validation, targeted Vitest tests, the updated Electron E2E specification, and type checking.
