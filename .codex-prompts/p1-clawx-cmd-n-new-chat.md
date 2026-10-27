# Task: P1 — ClawX #720 Cmd/Ctrl+N creates new chat (no blank window)

Repo: `/workspace/ClawX` (ValueCell-ai/ClawX). You are **already on branch** `cursor/p1-clawx-cmd-n-new-chat` from up-to-date `origin/main` at `ba5d1d4`. Stay on this branch. Do NOT merge. Do NOT commit secrets. One checkout only.

Do NOT touch chippo-platform, chippo-website, cad-plugin, secret-store/keychain/safeStorage, credentials, live OAuth, streaming/chat product invent, multi-window product design, refunds/Stripe/Singapore.

GitHub: `gh` as **hazeone**; `origin` = `https://github.com/ValueCell-ai/ClawX.git`. Push + open PR vs `main`. Do not merge. Tars squash-merges when green. Close or reference issue [#720](https://github.com/ValueCell-ai/ClawX/issues/720).

Peer notes (read-only): `/workspace/chippo-research/clawx-cmd-n-peers.md`. Discuss: `/workspace/chippo-research/next-after-27-discuss.md`. Follow `AGENTS.md` (UI changes need Electron E2E in the same PR).

## Locked brief (Tars + Debug + peers)
Fix **CmdOrCtrl+N** / File → New Chat so it creates a **new chat session in the existing main window** (same path as sidebar New Chat), without leaving a blank/unusable window. Cross-platform same PR (accelerator already `CmdOrCtrl+N`); verify Ctrl+N where CI OS allows — not mac-only.

Claude Desktop peer expectation: Cmd+N = new conversation in the **same** window.

### Must (In)
1. `CmdOrCtrl+N` / File → New Chat runs the same path as sidebar: `useNewChatAction` / `newSession` + navigate `/` in the **existing** main window.
2. Harden so the shortcut does **not** leave a blank/unusable window: **prevent** unexpected second `BrowserWindow` when possible; if one still appears, **close it and focus main**. Success = main stays usable with a new session (covers issue body).
3. Send `new-chat` IPC to the singleton **`mainWindow`** (not focused guest / blank secondary). Keep menu click path working.
4. Optional `before-input-event` guard (peer `electron/main/zoom-shortcuts.ts`) only if menu accelerator alone fails; if used, **invoke new-chat after preventDefault** (Electron #19279 — do not swallow without action).
5. E2E: real Playwright keyboard `Meta+N` / `Control+N` (or strongest available on the CI OS) asserting one usable main window + new-session / chat route; **keep** existing menu-click E2E in `tests/e2e/main-navigation.spec.ts`. Units for menu send / window-guard as needed.
6. Prefer root-cause path **A/C first**: claim accelerator + `mainWindow` IPC target + prevent unexpected windows; then guest/`before-input-event` if still needed. You may disambiguate under In without inventing product.
7. Commit this prompt under `.codex-prompts/p1-clawx-cmd-n-new-chat.md` (`git add -f` if gitignored).

### Out of scope
- Secret-store / keychain / safeStorage / docs-only keychain messaging as this PR
- Credentials, live OAuth smoke, inventing providers/product, streaming/chat invent
- Multi-window / multi-session-window product beyond “don’t open a blank one”
- Platform usage prev-cursor, openapi/oasdiff, Singapore/Redis/refunds/live Stripe/subs
- Cici website / cad-plugin
- Self-merge

### Likely touch points (non-binding)
`electron/main/menu.ts`, `electron/main/index.ts`, optional zoom-shortcuts-style input guard, preload/host-events already allow `new-chat`, `src/components/layout/use-new-chat-action.ts` (reuse), E2E under `tests/e2e/`.

### Done when
PR open, unmerged; URL printed; references #720; relevant unit + E2E green locally or failures clearly reported; short summary of root cause + fix + tests.

Minimal diff. Prefer `gh pr create` with `--body` or a tempfile under `/tmp` left in place (avoid `rm` of temp PR bodies that breaks sandbox).
