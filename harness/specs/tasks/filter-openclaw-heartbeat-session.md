---
id: filter-openclaw-heartbeat-session
title: Filter OpenClaw heartbeat-only chat sessions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent OpenClaw internal heartbeat poll transcripts from appearing as selectable user chat sessions while preserving real desktop conversations.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - harness/specs/tasks/filter-openclaw-heartbeat-session.md
  - electron/services/sessions-api.ts
  - shared/chat/openclaw-internal.ts
  - shared/host-api/contract.ts
  - src/stores/chat.ts
  - src/stores/chat/session-key-utils.ts
  - src/lib/relative-time.ts
  - src/pages/Chat/ChatInput.tsx
  - src/styles/globals.css
  - tests/unit/session-key-utils.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Sessions whose transcript only contains `[OpenClaw heartbeat poll]` are hidden from the sidebar and are not selected on startup.
  - Real sessions with user-authored titles or previews remain visible even if heartbeat text is present in metadata.
  - Sidebar relative activity labels never show future wording for activity timestamps slightly ahead of the renderer reference time.
  - The chat composer sending indicator uses the Zoomies loader.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/session-key-utils.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run build:vite
acceptance:
  - Renderer continues to consume session metadata through `hostApi.sessions.summaries` and does not call Main IPC directly.
  - Main marks heartbeat-only transcript summaries with a heartbeat-specific flag without using the heartbeat prompt as a title.
  - Startup/session hydration removes heartbeat-only sessions and switches away from them without selecting another old conversation as the implicit default.
  - README sync is reviewed; no user-facing documentation update is required for this bugfix.
docs:
  required: false
---

## Scope

This task covers a bugfix for OpenClaw internal heartbeat poll transcripts leaking
through the Host session summary path into the Chat sidebar, plus the related UI
loader and relative-time display fixes requested in the same change.

## Out of Scope

- Modifying OpenClaw runtime/package code.
- Changing ACP transport policy or adding renderer-side protocol switching.
- Changing documented workspace/session workflows.
