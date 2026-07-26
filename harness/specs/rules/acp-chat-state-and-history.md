---
id: acp-chat-state-and-history
title: ACP Chat State And History Authority
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - acp-file-activity
  - gateway-backend-communication
---

Main owns ACP process, SDK, and routing lifecycle; Renderer owns semantic reduction into an in-memory timeline. Live updates and replay use the same reducer path, stale session generations are ignored, and ClawX does not persist a second ACP ledger or reduced Chat history.

ACP replay is the primary history authority. The only approved transcript supplement is best-effort recovery of asynchronous image-generation completions when the same transcript first proves an `image_generate` start. Do not generalize that exception to messages, tool cards, plans, permissions, or file activity.
