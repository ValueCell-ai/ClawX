---
id: sidebar-session-attention-authority
title: Sidebar Session Attention Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

Sidebar active and unread-completion state must derive only from normalized OpenClaw Gateway session rows matched by exact catalog session key. ACP prompt state, ACP timeline updates, and Gateway agent runtime events must not derive or override sidebar session status. Run-scoped cron keys must not be folded into base-row attention while `sessions.list` cannot recover that relationship.

Unread state must come from an observed Gateway busy-to-idle transition, never from `updatedAt` or another activity timestamp. Persist only exact-key observed-busy and unread presentation state; do not persist messages, tools, timelines, runtime graphs, or route visibility.

A session is read when its conversation is visibly mounted in Chat or when the user activates its sidebar row. A retained current session key while Settings or another route is visible is not read authority. Completion for the visibly mounted Chat session remains read, and opening a conversation clears its unread state.
