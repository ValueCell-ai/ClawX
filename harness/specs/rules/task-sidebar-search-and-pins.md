---
id: task-sidebar-search-and-pins
title: Global task search and durable presentation pins
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

Search MUST filter the complete synchronized catalog after normal sidebar eligibility
checks, before pagination or collapse visibility. Title, assistant and workspace
matching MUST use display metadata without fetching conversation bodies.

Pins MUST store exact session keys through Main-owned settings. Pin order is independent
of activity order, and pinned tasks MUST appear only once. Renaming does not change
identity. Missing rows during refresh or failure MUST NOT prune pins. Successful exact
session deletion, bulk deletion and assistant deletion MUST remove the matching pins.

Search and pin state MUST NOT derive attention, create catalog rows, switch sessions,
send prompts, or erase drafts. Busy/unread states retain the Gateway-owned policy.

The task action trigger MUST NOT reserve row width while hidden. Idle metadata
uses the right edge of the row; hover, keyboard focus and an open menu reveal
the overlaid trigger without obscuring the title or displaying metadata behind it.
The trigger remains keyboard reachable and receives focus when its menu closes.
