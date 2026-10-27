---
id: fix-new-chat-shortcut
title: Keep the New Chat shortcut in the existing main window
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Route CmdOrCtrl+N and File New Chat to the sidebar's existing new-session action and recover from unexpected blank windows for issue 720.
touchedAreas:
  - electron/main/menu.ts
  - electron/main/index.ts
  - electron/main/main-window-guard.ts
  - tests/unit/menu.test.ts
  - tests/unit/main-window-guard.test.ts
  - tests/unit/e2e-parallel-policy.test.ts
  - tests/e2e/main-navigation.spec.ts
  - harness/specs/tasks/fix-new-chat-shortcut.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/single-window-new-chat.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .codex-prompts/p1-clawx-cmd-n-new-chat.md
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
  - pnpm exec vitest run tests/unit/menu.test.ts tests/unit/main-window-guard.test.ts tests/unit/use-new-chat-action.test.tsx tests/unit/e2e-parallel-policy.test.ts
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/main-navigation.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run harness:ci
acceptance:
  - New Chat IPC always targets the live main-window singleton, including after menu language refresh.
  - Renderer and guest popup requests remain denied by existing window-open policies.
  - Any unexpected second BrowserWindow is closed and focus returns to main.
  - Native keyboard input driven through Playwright confirms a fresh session, chat route, and one usable main window; menu-click coverage is retained.
  - No new session, window, transport, or credential product behavior is introduced.
docs:
  required: true
---

Reuses `hostEvents.onNewChat` and `useNewChatAction`; Main owns the menu accelerator,
window identity, and window recovery. The macOS report requires native macOS
confirmation when available; Linux keyboard coverage verifies Ctrl+N locally.
Playwright CDP `page.keyboard.press` bypasses Electron's menu and before-input
events on this Linux runner. The exclusive E2E uses OS Ctrl+N via `xdotool` when
available, with native `webContents.sendInputEvent` keydown/keyup pairs as the
cross-platform fallback. Both exercise the actual menu accelerator.
