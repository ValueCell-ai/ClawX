---
id: fix-agent-deletion-session-catalog
title: Reconcile chat sessions after agent deletion
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent deleted agents from leaving sidebar conversations that can neither load nor be removed, while making the destructive confirmation explicit about permanent chat-history deletion.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
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
  - src/stores/chat/session-label-hydration.ts
  - src/lib/workspace-context.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/pages/Agents/index.tsx
  - src/pages/Chat/index.tsx
  - tests/unit/chat-session-management.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/agents-store.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/e2e/agent-deletion.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-workspace-context.spec.ts
expectedUserBehavior:
  - Deleting a non-default agent requires confirmation that the agent, managed workspace, and all associated chat history will be permanently deleted and cannot be recovered.
  - After Main confirms deletion, every renderer session whose canonical key belongs to that agent disappears immediately without waiting for a Gateway restart or another sessions.list request.
  - If the deleted agent owns the selected conversation, Chat selects a safe surviving conversation, preferring the main agent, or creates a main-agent local placeholder when no safe conversation remains.
  - Renderer-only labels, activity, composer drafts, pending catalog state, label hydration state, and persisted attention for removed sessions are cleared.
  - The deleted Agent ID remains an in-memory session-catalog tombstone so delayed `sessions.changed` events, buffered events, and stale `sessions.list` rows cannot recreate orphan conversations.
  - An authoritative Agent snapshot containing a recreated Agent ID clears its tombstone so new conversations for that Agent can appear normally.
  - An Agent-list request that began before a confirmed mutation cannot publish or reconcile afterward, so a stale pre-deletion snapshot cannot clear the deleted Agent tombstone.
  - The first conversation in a newly created non-default Agent uses its first prompt as the sidebar title instead of exposing the synthetic `ACP` transport display name, including after transcript-summary hydration on reload.
  - The canonical default session `agent:main:main` always remains in the default workspace even if stale ACP replay metadata reports a cwd from another Agent workspace.
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
  - pnpm exec vitest run tests/unit/chat-session-management.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-load-sessions-startup.test.ts tests/unit/workspace-context.test.ts tests/unit/session-buckets.test.ts tests/unit/gateway-events.test.ts tests/unit/agents-store.test.ts tests/unit/host-services.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/agent-deletion.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-workspace-context.spec.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Agent deletion remains Main-authoritative and Renderer calls it only through the typed host API.
  - Renderer forgets an agent's sessions only after the host agent deletion succeeds; a failed deletion preserves the existing chat catalog.
  - Session ownership is matched by the exact canonical prefix `agent:<agentId>:` so similarly named agents are not affected.
  - Selection repair never creates a placeholder for the agent that was just deleted.
  - Session rows and events matching a deleted Agent tombstone are rejected across live, buffered, fallback, and list-publication paths until an authoritative Agent snapshot contains that ID again.
  - Confirmed Agent mutations advance the authoritative snapshot generation; list responses and errors from an older generation are ignored without changing Agent state, tombstones, loading, or errors.
  - Non-default `agent:<id>:main` sessions receive the same bounded, sanitized first-prompt title and summary hydration as other conversations, while `agent:main:main` retains its special default-main behavior.
  - Workspace resolution and sidebar grouping pin `agent:main:main` to the canonical default workspace rather than trusting stale ACP cwd metadata from another Agent.
  - Already-absent sessions are treated as successfully deleted only for ENOENT session-index reads or a missing session-index entry; malformed JSON, access failures, and out-of-scope transcript paths are not hidden.
  - User-facing copy is complete in English, Chinese, Japanese, and Russian.
  - The flow does not restore the removed Gateway restart and does not add direct Renderer IPC or Gateway HTTP calls.
docs:
  required: true
---

This task references `gateway-backend-communication` because the fix spans the typed agents host operation, Main-owned on-disk session deletion semantics, and Renderer chat-catalog reconciliation. It also extends the existing hard-delete contract: deleting a session that is already absent is an idempotent success, while unsafe or unreadable state remains an actionable failure.
