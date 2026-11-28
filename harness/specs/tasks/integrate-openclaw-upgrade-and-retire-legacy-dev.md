---
id: integrate-openclaw-upgrade-and-retire-legacy-dev
title: Integrate the OpenClaw upgrade and retire the temporary development profile
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Merge main's upgraded runtime with the branch's model and workspace flows and remove the pre-upgrade developer launcher.
touchedAreas:
  - .gitattributes
  - AGENTS.md
  - README*.md
  - docs/**
  - electron/**
  - harness/**
  - package.json
  - patches/**
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - scripts/**
  - shared/**
  - src/**
  - tests/**
  - tsconfig.node.json
  - vite.config.ts
expectedUserBehavior:
  - Normal development runs the upgraded OpenClaw runtime.
  - Agent creation persists the chosen model and instructions and waits for provider authentication synchronization.
  - Composer model changes stay scoped to their task, while Agent model writes respect Gateway readiness.
  - Workspace previews retain frontmatter disclosure and Chat keeps scoped local-file links.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - model-selection-scopes
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/model-selection-service.test.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - No temporary legacy launcher, runtime profile, or test fixture remains.
  - Existing local state, copied workspaces, and backups are not modified during cleanup.
  - Upgraded Gateway startup, storage migration, and plugin safety behavior stay intact.
docs:
  required: true
---

See [OpenClaw upgrade](../../reference/openclaw-2026-10-5-upgrade.md) for runtime and storage requirements.
