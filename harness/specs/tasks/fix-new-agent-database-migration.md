---
id: fix-new-agent-database-migration
title: Preserve and migrate OpenClaw agent database schemas
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent ClawX credential synchronization from downgrading canonical OpenClaw agent databases and ensure newly created Agents are migrated before their first chat.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/tasks/fix-new-agent-database-migration.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-agent-database-ownership.md
  - harness/reference/openclaw-session-storage.md
  - electron/services/agents-api.ts
  - electron/utils/openclaw-auth-sqlite.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/host-services.test.ts
expectedUserBehavior:
  - Creating an Agent while the Gateway is running completes any required OpenClaw database migration before the create operation succeeds.
  - The first prompt sent to a newly created Agent does not fail because its database remains at the auth bootstrap schema.
  - Synchronizing provider credentials never lowers the schema version of an existing canonical OpenClaw agent database.
  - Existing migrated conversations and credentials remain available.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - openclaw-agent-database-ownership
  - openclaw-config-delivery
  - backend-communication-boundary
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
acceptance:
  - Auth SQLite writes create the minimal version-1 bootstrap schema only for a database whose user version is zero.
  - Auth SQLite writes preserve PRAGMA user_version and schema_meta metadata on every existing nonzero-version database.
  - Agent creation awaits provider-auth synchronization and a managed Gateway restart when a pending Agent database migration is detected.
  - The managed restart reuses the existing offline migration preflight and verifies that no pending Agent database remains before creation succeeds.
  - ClawX does not implement OpenClaw's version-1-to-version-19 schema migration SQL itself.
  - Harness validation, type checks, focused unit tests, communication regression checks, and the created-Agent first-send Electron E2E pass.
docs:
  required: true
---

This task references `gateway-backend-communication` because Agent creation,
credential delivery, the managed Gateway lifecycle, and first-message readiness
must remain one Main-owned operation. OpenClaw Doctor remains the canonical
owner of full agent database migrations; ClawX only owns its bounded auth-table
bootstrap and must not overwrite canonical schema metadata.
