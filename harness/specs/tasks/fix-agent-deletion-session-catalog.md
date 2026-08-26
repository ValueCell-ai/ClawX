---
id: fix-agent-deletion-session-catalog
title: Reconcile chat sessions after agent deletion
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent deleted agents from leaving sidebar conversations that can neither load nor be removed, while making the destructive confirmation explicit about permanent chat-history deletion.
touchedAreas:
  - harness/specs/tasks/fix-agent-deletion-session-catalog.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/hard-delete-session-jsonl.md
  - shared/chat/types.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - electron/services/sessions-api.ts
  - src/stores/agents.ts
  - src/stores/chat.ts
  - src/pages/Agents/index.tsx
  - tests/unit/chat-session-management.test.ts
  - tests/unit/agents-store.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/e2e/agent-deletion.spec.ts
expectedUserBehavior:
  - Deleting a non-default agent requires confirmation that the agent, managed workspace, and all associated chat history will be permanently deleted and cannot be recovered.
  - After Main confirms deletion, every renderer session whose canonical key belongs to that agent disappears immediately without waiting for a Gateway restart or another sessions.list request.
  - If the deleted agent owns the selected conversation, Chat selects a safe surviving conversation, preferring the main agent, or creates a main-agent local placeholder when no safe conversation remains.
  - Renderer-only labels, activity, composer drafts, pending catalog state, label hydration state, and persisted attention for removed sessions are cleared.
  - A later attempt to remove an already-absent conversation is idempotent when the agent sessions directory or the session index entry is already gone.
  - Permission, malformed JSON, unsafe paths, and other genuine deletion failures remain failures.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fix-agent-deletion-session-catalog.md
  - pnpm exec vitest run tests/unit/chat-session-management.test.ts tests/unit/agents-store.test.ts tests/unit/host-services.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/agent-deletion.spec.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Agent deletion remains Main-authoritative and Renderer calls it only through the typed host API.
  - Renderer forgets an agent's sessions only after the host agent deletion succeeds; a failed deletion preserves the existing chat catalog.
  - Session ownership is matched by the exact canonical prefix `agent:<agentId>:` so similarly named agents are not affected.
  - Selection repair never creates a placeholder for the agent that was just deleted.
  - Already-absent sessions are treated as successfully deleted only for ENOENT session-index reads or a missing session-index entry; malformed JSON, access failures, and out-of-scope transcript paths are not hidden.
  - User-facing copy is complete in English, Chinese, Japanese, and Russian.
  - The flow does not restore the removed Gateway restart and does not add direct Renderer IPC or Gateway HTTP calls.
docs:
  required: false
---

This task references `gateway-backend-communication` because the fix spans the typed agents host operation, Main-owned on-disk session deletion semantics, and Renderer chat-catalog reconciliation. It also extends the existing hard-delete contract: deleting a session that is already absent is an idempotent success, while unsafe or unreadable state remains an actionable failure.
