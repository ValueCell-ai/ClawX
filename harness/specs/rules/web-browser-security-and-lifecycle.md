---
id: web-browser-security-and-lifecycle
title: Web Browser Security And Lifecycle
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
requiredProfiles:
  - e2e
---

The Web Browser uses one guest and one hardcoded persistent partition. Do not create extra guests, BrowserWindows, BrowserViews, or WebContentsViews; accept arbitrary partitions; attach a guest preload; enable Node integration; disable context isolation, sandboxing, or web security; or expose the ClawX host bridge to guest content.

Renderer pages and components must not call direct IPC or `webview.loadURL()`. Address and recovery navigation use the typed Host API, while Main validates application navigation, page navigation, redirects, popup targets, and the registered guest URL before external opening. Renderer must not supply an arbitrary external-open destination.

Every popup is denied and an allowed target is loaded in the one registered guest. Do not claim compatibility with `window.opener`, returned window handles, initially blank scripted popups, or full POST/referrer/named-window behavior.

Permission decisions follow the table in `harness/reference/web-browser.md`: do not remember grants, broaden allowed permissions, or install display-capture behavior. Downloads use Electron defaults; do not cancel downloads, set paths, or add custom download handling or management UI. Do not synchronize the ClawX client proxy to the browser partition.

Once initialized, the global guest remains mounted while hidden across panel, tab, session, and route changes. Do not unmount, suspend, mute, reload, or recreate it for ordinary visibility changes. Only a destroyed guest may be replaced during explicit crash recovery.
