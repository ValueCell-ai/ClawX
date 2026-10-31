---
id: fix-new-chat-shortcut
title: Keep the New Chat shortcut in the existing main window
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Route CmdOrCtrl+N and File New Chat to the sidebar's existing new-session action, including macOS Electron input that bypasses NSMenu accelerators, and recover from unexpected blank windows for issue 720 and PR 1322.
touchedAreas:
  - electron/main/menu.ts
  - electron/main/new-chat-shortcut.ts
  - electron/main/index.ts
  - electron/main/main-window-guard.ts
  - tests/unit/menu.test.ts
  - tests/unit/new-chat-shortcut.test.ts
  - tests/unit/main-window-guard.test.ts
  - tests/unit/e2e-parallel-policy.test.ts
  - tests/e2e/main-navigation.spec.ts
  - harness/specs/tasks/fix-new-chat-shortcut.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/single-window-new-chat.md
  - harness/reference/chat-workspace-and-navigation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .codex-prompts/p1-clawx-cmd-n-new-chat.md
  - .codex-prompts/p1-clawx-cmd-n-macos-e2e.md
expectedUserBehavior:
  - Cmd+N on macOS and Ctrl+N on Windows and Linux start a new chat in the existing main window.
  - File New Chat and sidebar New Chat use the same renderer session action and navigate to the chat route.
  - Unexpected secondary app windows are closed and the usable main window is focused.
requiredProfiles:
  - fast
  - e2e
  - comms
requiredRules:
  - single-window-new-chat
  - renderer-main-boundary
  - host-events-fallback-policy
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/menu.test.ts tests/unit/new-chat-shortcut.test.ts tests/unit/main-window-guard.test.ts tests/unit/use-new-chat-action.test.tsx tests/unit/e2e-parallel-policy.test.ts
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/main-navigation.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run harness:ci
acceptance:
  - New Chat IPC always targets the live main-window singleton, including after menu language refresh.
  - The before-input-event handler prevents the platform CmdOrCtrl+N keydown before invoking the shared menu action exactly once; keyup and unrelated shortcuts are ignored.
  - Renderer and guest popup requests remain denied by existing window-open policies.
  - Any unexpected second BrowserWindow is closed and focus returns to main.
  - Native keyboard input driven through Playwright confirms a fresh session, chat route, and one usable main window; menu-click coverage is retained.
  - No new session, window, transport, or credential product behavior is introduced.
docs:
  required: true
---

The exclusive E2E retains OS Ctrl+N via `xdotool` when available and Electron
keydown/keyup input otherwise. A separate E2E isolates the before-input-event
path with menu shortcuts ignored. The macOS report still requires macOS CI
confirmation; Linux keyboard coverage verifies Ctrl+N locally.
Compatibility and delivery details are in
[Chat Workspace And Navigation](../../reference/chat-workspace-and-navigation.md#new-chat-shortcut).

README.md, README.zh-CN.md, and README.ja-JP.md were reviewed for this follow-up.
They already describe the intended shortcut and existing-window behavior; this
delivery repair adds no user-facing flow or interface requiring further changes.
