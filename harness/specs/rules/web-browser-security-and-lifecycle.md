---
id: web-browser-security-and-lifecycle
title: Local HTML preview security and lifecycle
appliesTo:
  - shared/web-browser.ts
  - shared/host-api/contract.ts
  - electron/main/web-browser-policy.ts
  - electron/main/web-browser-session.ts
  - electron/services/web-browser-api.ts
  - src/components/web-browser/**
  - src/components/file-preview/**
  - src/stores/artifact-panel.ts
severity: error
---

# Local HTML preview security and lifecycle

- Treat agent-produced HTML as untrusted. Keep one dedicated-session webview with no preload, Node integration, plugins, insecure content, popup capability, or ClawX bridge; require sandboxing, context isolation, and web security.
- Application navigation may load only a hostless, query-free, fragment-free `file:///` URL whose path ends in `.html` or `.htm`. Renderer must derive it from an already validated attachment or Workspace reference and call the typed Host API.
- The guest is a Preview implementation detail. Do not expose a Web Browser tab, Home page, address bar, history controls, site-data controls, general HTTP navigation, or an empty guest entry point.
- Every link is inert. Inject user-origin CSS that removes anchor/area color, decoration, pointer cursor, and pointer events. Independently prevent all guest `will-frame-navigate`, redirect, invalid programmatic, in-page, form, and script navigation.
- Deny every popup and every permission. Cancel downloads. Block HTTP(S), WebSocket, and other network requests in the dedicated Session, and reject any non-HTML main document.
- Keep the single-guest registry and exact attachment identity gate. Main may load a validated HTML file or open an explicitly supplied, independently revalidated local HTML URL through `shell.openExternal`; no general web URL or storage-management API belongs to this feature.
- The route-stable host may remain mounted while another panel tab is active, but it must be invisible, pointer-inert, accessibility-hidden, and unable to receive focus.
- All visible labels and failures use the complete English, Chinese, Japanese, and Russian locale resources and project design tokens.
