---
id: fix-chat-history-gateway-timeout
title: Fix chat history timeout through gateway backend communication
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Adjust backend communication behavior for chat history loading.
touchedAreas:
  - src/lib/api-client.ts
  - src/stores/chat/history-actions.ts
expectedUserBehavior:
  - Chat history loads through the existing host API boundary.
  - Gateway timeout does not leave the visible chat in a stale state.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/chat-history-actions.test.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Comms replay and compare pass.
docs:
  required: false
---

Example task spec for gateway backend communication work. Copy this file to a task-specific name before starting an AI Coding change.
