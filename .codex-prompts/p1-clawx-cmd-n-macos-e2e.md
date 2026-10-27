# Task: Fix ClawX #1322 macOS Electron E2E — Cmd+N chat-page not visible

Repo: `/workspace/ClawX` (ValueCell-ai/ClawX). Stay on existing PR branch **`cursor/p1-clawx-cmd-n-new-chat`** (PR [#1322](https://github.com/ValueCell-ai/ClawX/pull/1322), head `c0b1a05`, base `ba5d1d4`). Do NOT create a new branch. Do NOT merge. Do NOT commit secrets. One checkout only.

Do NOT touch chippo-platform, chippo-website, cad-plugin, secret-store/keychain, credentials, live OAuth, streaming/chat invent, refunds/Stripe/Singapore, usage prev-cursor.

GitHub: `gh` as **hazeone**; `origin` = `https://github.com/ValueCell-ai/ClawX.git`. Push commits to the same PR branch. Do not merge. Tars squash-merges only after macOS E2E is green.

## Failure (must fix — do not skip/disable)

**Electron E2E (macos-latest)** exclusive test fails:
`New Chat keyboard shortcut keeps one usable main window` @ `tests/e2e/main-navigation.spec.ts:145`

After `pressNativeNewChatShortcut(app)` (from models page), `getByTestId('chat-page')` not visible (15s ×3 retries).

Job: https://github.com/ValueCell-ai/ClawX/actions/runs/40577446658/job/122447554258

**Already green:** check, build, harness, Electron E2E ubuntu + windows. Keep those green.

macOS native Cmd+N is the original [#720](https://github.com/ValueCell-ai/ClawX/issues/720) reporter platform — **do not** `test.skip` / disable / remove the exclusive case.

## Locked brief still applies

Cross-platform `CmdOrCtrl+N`; real keypress E2E + keep menu-click; prevent second window then close+focus main; always send `new-chat` to singleton `mainWindow`; prefer A/C then `before-input-event` with **invoke after preventDefault** (Electron #19279).

## Likely root cause (investigate; disambiguate under In)

On darwin, `webContents.sendInputEvent({ keyDown Meta+N })` often **does not** fire Electron application-menu accelerators (AppKit/NSMenu path). Ubuntu/Windows passed with the current helper; macOS stayed on models-page → chat-page never visible.

## Must (In)

1. Harden so the exclusive E2E’s `pressNativeNewChatShortcut` results in usable main-window new chat on **macOS** (and does not regress linux/windows).
2. Prefer one or both (minimal diff):
   - **App delivery:** register a `before-input-event` for Cmd/Ctrl+N (mirror `electron/main/zoom-shortcuts.ts` style) that `preventDefault` then **invokes the same new-chat action** as the File menu (`getMainWindow` + `send('new-chat')`). Do not swallow without action.
   - **Test helper:** make `pressNativeNewChatShortcut` reliably deliver Meta+N on darwin (e.g. `osascript` System Events keystroke when available; and/or emit/`sendInputEvent` shape that the before-input handler accepts — see zoom E2E which emits `before-input-event`). Still a **keyboard/shortcut** path — do **not** replace this exclusive test with menu `.click()` (menu-click already has its own test).
3. Keep menu-click E2E. Keep exclusive tag. Keep blank-window recovery assertions.
4. Units for any new before-input / shortcut helper. Locally run relevant unit + whatever E2E you can on linux.
5. Commit this prompt under `.codex-prompts/p1-clawx-cmd-n-macos-e2e.md` (`git add -f` if gitignored).
6. Push to same branch so PR #1322 CI re-runs.

## Out of scope

- Skipping/disabling the exclusive macOS case
- New PR / new branch / self-merge
- Secret-store, product invent, platform usage prev-cursor, Cici lanes

## Done when

Commits pushed to `cursor/p1-clawx-cmd-n-new-chat` on #1322; short summary of root cause + fix; local units green; note that macOS CI must go green (you cannot run macos-latest here). Print PR URL. Do not merge.
