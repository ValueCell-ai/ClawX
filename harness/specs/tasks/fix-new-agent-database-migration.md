---
id: fix-new-agent-database-migration
title: Preserve and migrate OpenClaw agent database schemas
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent ClawX credential synchronization from downgrading canonical OpenClaw agent databases and initialize new Agent databases at the bundled schema without a migration restart.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/tasks/fix-new-agent-database-migration.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-agent-database-ownership.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-session-storage.md
  - harness/reference/openclaw-config-delivery.md
  - electron/services/agents-api.ts
  - electron/types/openclaw-sqlite-runtime.d.ts
  - electron/utils/agent-config.ts
  - electron/utils/openclaw-auth-sqlite.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/host-services.test.ts
expectedUserBehavior:
  - Creating an Agent uses OpenClaw's dedicated `agents.create` RPC instead of waiting on a generic `config.set` roster mutation.
  - Creating an Agent while the Gateway is running initializes its database at the bundled OpenClaw schema without restarting the Gateway.
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
  - Main delegates authoritative Agent roster and workspace creation to `agents.create`.
  - ClawX applies requested workspace inheritance and runtime credential files only after the RPC succeeds.
  - If post-create provisioning fails, ClawX attempts to roll back the newly created Agent through `agents.delete` rather than removing its roster entry through `config.set`.
  - Auth SQLite writes invoke OpenClaw's exported schema initializer for a database whose user version is zero.
  - New Agent credential synchronization does not create a version-1 bootstrap database or require a migration restart.
  - Auth SQLite writes preserve PRAGMA user_version and schema_meta metadata on every existing nonzero-version database.
  - Agent creation awaits provider-auth synchronization and only uses the managed migration restart as a fallback for a pre-existing pending database.
  - ClawX does not implement or copy OpenClaw's canonical schema or migration SQL itself.
  - Harness validation, type checks, focused unit tests, communication regression checks, and the created-Agent first-send Electron E2E pass.
docs:
  required: true
---

This task references `gateway-backend-communication` because Agent creation,
credential delivery, the managed Gateway lifecycle, and first-message readiness
must remain one Main-owned operation. OpenClaw owns both canonical schema
initialization and full database migrations; ClawX invokes those contracts and
must not overwrite canonical schema metadata.
