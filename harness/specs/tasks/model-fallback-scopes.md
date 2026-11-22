---
id: model-fallback-scopes
title: Manage model fallbacks at their actual OpenClaw scope
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Manage ordered global and agent fallback chains without treating them as per-provider settings or migrating existing data.
touchedAreas:
  - electron/**
  - shared/**
  - src/**
  - tests/**
  - harness/specs/tasks/model-fallback-scopes.md
  - harness/specs/rules/models-configuration-experience.md
  - README*.md
expectedUserBehavior:
  - View and edit the global default fallback chain and individual assistant chains.
  - Preserve explicitly empty agent chains and inherited primary models.
  - Explicit task model selections remain strict under OpenClaw rules.
  - Existing saved configurations remain unchanged until explicitly edited.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - models-configuration-experience
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/e2e/model-fallbacks.spec.ts
acceptance:
  - Ordered model references are stored in their native OpenClaw scope without changing other fields.
  - Saving an unrelated provider cannot overwrite global fallback changes.
  - Existing model overrides and explicit empty chains remain intact.
docs:
  required: true
---
