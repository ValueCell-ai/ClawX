---
id: renderer-main-boundary
title: Renderer Main Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Renderer pages and components use the existing host API and API client modules as their only backend entrypoints. Main-process IPC details stay behind those modules.
