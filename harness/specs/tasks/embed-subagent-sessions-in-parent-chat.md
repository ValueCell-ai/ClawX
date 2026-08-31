---
id: embed-subagent-sessions-in-parent-chat
title: Embed subagent sessions in their parent conversation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Hide native subagent sessions from the sidebar, expose their ACP lineage and titles inside the direct parent conversation, and preserve Gateway-authoritative live run status.
touchedAreas:
  - harness/specs/tasks/embed-subagent-sessions-in-parent-chat.md
  - harness/specs/tasks/surface-subagent-sessions-and-announcements.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/sidebar-session-attention-authority.md
  - harness/reference/acp-chat.md
  - harness/reference/chat-workspace-and-navigation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/acp-chat/types.ts
  - shared/acp-chat/subagent-lineage.ts
  - shared/host-api/contract.ts
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - src/lib/host-api.ts
  - src/lib/acp/subagent-lineage.ts
  - src/components/layout/Sidebar.tsx
  - src/components/settings/IssueReportExport.tsx
  - src/pages/Chat/AcpSubagentSessions.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/chat/session-key-utils.ts
  - src/stores/chat/session-selection.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-subagent-lineage.test.ts
  - tests/unit/acp-subagent-sessions.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-artifact-panel-layout.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/chat-session-management.test.ts
  - tests/unit/chat-session-selection.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/issue-report-export.test.tsx
  - tests/unit/session-catalog.test.ts
  - tests/unit/session-key-utils.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/e2e/chat-subagent-sessions.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - tests/e2e/settings-issue-report.spec.ts
expectedUserBehavior:
  - Native `agent:<agentId>:subagent:<id>` sessions no longer appear as rows in the left sidebar, but remain in the shared session catalog for status, routing, and existing deletion behavior.
  - A parent conversation shows the localized composer control immediately left of the current plan control with the child count only when at least one ACP-listed direct native child is also present under its exact key in the latest Gateway catalog.
  - The aggregate control and each child row show a loading icon while any corresponding exact Gateway session row is busy, and a bot icon otherwise, using the same run projection and observed-busy fallback as the current sidebar.
  - Each expanded row appears only for an ACP-listed direct child that is also present under its exact key in the latest Gateway catalog. Its label uses the ACP session title after display-only removal of a leading `[Subagent Context]` marker. ACP remains the sole lineage membership and title authority; Gateway absence only gates current actionability.
  - A child appears during the live parent conversation after a successful structured ACP `sessions_spawn` result triggers canonical ACP lineage refresh, and the same relationship returns after conversation switching or Renderer reload.
  - Selecting an available child row opens that child conversation. A child conversation shows a localized subagent marker, and its explicit return action appears only while its ACP-listed direct parent is also present under its exact key in the latest Gateway catalog.
  - Deleting a parent session retains the existing exact-session deletion behavior and does not cascade to children.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - acp-chat-state-and-history
  - sidebar-session-attention-authority
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/embed-subagent-sessions-in-parent-chat.md
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts tests/unit/acp-subagent-lineage.test.ts tests/unit/acp-subagent-sessions.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx tests/unit/host-api-facade.test.ts tests/unit/session-key-utils.test.ts tests/unit/session-status.test.ts tests/unit/session-attention.test.ts tests/unit/harness-specs.test.ts tests/unit/i18n-locale-parity.test.ts
  - pnpm exec playwright test tests/e2e/chat-subagent-sessions.spec.ts tests/e2e/chat-sidebar-session-attention.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ACP `session/list` is the sole lineage membership and title authority. Main validates `SessionInfo._meta`, prefers `parentSessionId`, falls back to `spawnedBy`, rejects malformed and self-referential lineage, follows bounded cursors, and returns only the requested current session plus its direct native children.
  - Renderer does not infer lineage from session-key UUIDs, assistant prose, announcement text, Gateway parent fields, or persisted local state.
  - A completed structured accepted ACP `sessions_spawn` tool result with non-empty `runId` and `childSessionKey` is only an invalidation signal for lineage refresh; canonical ACP `session/list` still determines whether and where the child is displayed.
  - Latest exact-key Gateway catalog presence gates current child visibility and actionability plus direct-parent return-target availability. Presence does not create lineage membership or titles. Gateway `sessions.list` and `sessions.changed` exact-key `status` and `hasActiveRun` fields remain the sole run-state authority. ACP prompt state and local sending state do not drive child loading icons.
  - Lineage requests are scoped to the requested current session and reject stale completion after selection changes. Failures hide or preserve only already current family data and never block ordinary ACP conversation loading.
  - Sidebar filtering is presentation-only. Hidden subagent rows remain available to exact-key attention reconciliation, workspace cleanup, navigation, and existing non-cascading deletion behavior.
  - Child navigation uses the existing session selection and ACP load path. The explicit return action targets the direct ACP parent rather than browser history.
  - Live status changes do not collapse an open child list. Changing the selected conversation closes the prior conversation's child panel.
  - All visible and accessible text is localized in English, Chinese, Japanese, and Russian and uses established composer, panel, selected-state, and status design tokens.
docs:
  required: true
---

## Scope

The feature adds a typed Main-owned ACP `session/list` operation because lineage is Chat semantics exposed by ACP. ACP `session/list` is the sole lineage membership and title authority. Latest exact-key Gateway catalog presence gates current child visibility and actionability plus direct-parent return-target availability; presence never creates lineage membership or titles. Gateway `status` and `hasActiveRun` remain the sole run-state authority. The lineage projection is in-memory and reloadable; it is not a second transcript, status catalog, or persisted relationship database.

## Bounded History

The bounded walk requests 100 rows per page and follows at most 128 pages. Only sessions returned by the bundled OpenClaw ACP `session/list` implementation are eligible. Archived, deleted, cleaned, or otherwise unlisted historical children are excluded. The family query does not scan transcripts, announcements, assistant prose, Gateway lineage, or child UUIDs to recover them.

## Out Of Scope

- Cascading parent deletion to child sessions.
- Recovering very old, archived, deleted, or cleaned subagent sessions.
- Inferring child completion from announcements or assistant text.
- Replacing the Gateway session catalog run-state projection with ACP prompt state.
