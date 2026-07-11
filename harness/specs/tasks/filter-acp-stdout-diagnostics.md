---
id: filter-acp-stdout-diagnostics
title: Filter non-protocol OpenClaw ACP stdout diagnostics before SDK parsing
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent OpenClaw startup diagnostics written to stdout from reaching the ACP SDK NDJSON parser while preserving JSON-RPC stdout as the ACP transport stream.
touchedAreas:
  - harness/specs/tasks/filter-acp-stdout-diagnostics.md
  - electron/services/acp-chat-service.ts
  - tests/unit/acp-chat-service.test.ts
expectedUserBehavior:
  - Starting ClawX with OpenClaw ACP no longer emits SDK JSON parse errors for decorative diagnostic stdout lines such as clack note output beginning with `│`.
  - ACP chat session load, prompt, cancel, session updates, and permission requests continue to use the Main-owned OpenClaw ACP stdio bridge.
  - Renderer API boundaries remain unchanged; no direct renderer IPC, Gateway HTTP, or Gateway WebSocket transport is added.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The ACP child stdout stream drops complete non-empty lines that are not JSON-RPC object lines before passing stdout to `ndJsonStream`.
  - Dropped stdout diagnostics are routed to ClawX logging instead of the ACP SDK parser.
  - Valid JSON-RPC object lines remain byte-streamed to the SDK with newline delimiters.
  - OpenClaw source and packaged dependencies are not modified.
docs:
  required: false
---
