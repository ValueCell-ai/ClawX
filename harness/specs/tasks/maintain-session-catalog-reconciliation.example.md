---
id: maintain-session-catalog-reconciliation
title: Maintain session catalog reconciliation alongside ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Adjust session catalog reconciliation without creating a second ACP history or prompt-state authority.
touchedAreas:
  - src/stores/chat/session-catalog.ts
  - src/stores/chat.ts
expectedUserBehavior:
  - Gateway reconnects reconcile normalized session rows without replacing the selected ACP timeline.
  - Delayed catalog metadata cannot overwrite a newer local session selection or mutation.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/session-catalog.test.ts
  - tests/unit/chat-session-management.test.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - ACP session/load remains the ordinary Chat history authority.
  - Session catalog updates remain generation- and mutation-fenced.
  - Comms replay and compare pass.
docs:
  required: false
---

Structural example for maintaining the Gateway-backed session catalog alongside ACP Chat through the backend communication scenario. Copy it to a task-specific file and replace the example identity before starting an AI Coding change.
