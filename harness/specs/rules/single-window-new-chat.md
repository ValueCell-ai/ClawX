---
id: single-window-new-chat
title: Single-window New Chat
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

File New Chat and CmdOrCtrl+N send the existing `new-chat` host event to the live
main-window singleton. They reuse the sidebar's `useNewChatAction` for session
creation and navigation. Focused guests or secondary windows never receive it.

Keep renderer and guest window-open requests denied. Close unexpected secondary
app windows and focus main without claiming them as the main window. Preserve
initial creation, main-window recreation, and developer tools.

Retain native menu-click E2E coverage and keyboard coverage for the platform
accelerator, a fresh chat session, and one usable main window. Where Playwright's
CDP keyboard bypasses native menus, use OS key input or drive Electron's
`sendInputEvent` through Playwright instead of calling the menu click or emitting
a synthetic input event. OS key injection requires the exclusive E2E tag.
