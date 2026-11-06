---
id: retry-rolled-back-config-publication
title: Recover a model switch after a rolled-back Gateway config publication
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let the Main config coordinator replay a model selection when OpenClaw confirms a partial publication hit an identity conflict and rolled back.
touchedAreas:
  - harness/specs/tasks/retry-rolled-back-config-publication.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
  - electron/gateway/config-delivery.ts
  - tests/unit/gateway-config-delivery.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - One transient, fully rolled-back publication conflict can recover within the original model selection.
  - Persistent conflicts and inconclusive rollback outcomes remain visible to the caller.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-config-delivery
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/gateway-config-delivery.test.ts
acceptance:
  - Share the existing one-retry limit with base-hash conflicts and rebuild the edit using the latest Gateway snapshot and hash.
  - Require both the partial-publication identity conflict and OpenClaw's explicit confirmation of rollback.
  - Keep the Gateway's file identity checks and surface other publication failures.
docs:
  required: true
---

The November 6 diagnostic log records a failed `config.set` followed nine seconds later by a successful model selection and hot reload. The replay belongs in the existing Gateway config transaction.
