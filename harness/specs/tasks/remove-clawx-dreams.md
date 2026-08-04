---
id: remove-clawx-dreams
title: Remove the ClawX Dreams integration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the developer-only ClawX Dreams page and its dedicated Control UI view while preserving generic Gateway communication, memory capability diagnostics, and existing OpenClaw dreaming configuration and data.
touchedAreas:
  - harness/specs/tasks/remove-clawx-dreams.md
  - harness/specs/tasks/image-generation-settings.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - src/pages/Dreams/**
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/lib/host-api.ts
  - shared/host-api/contract.ts
  - electron/services/gateway-api.ts
  - electron/utils/openclaw-control-ui.ts
  - shared/i18n/resources.ts
  - shared/i18n/locales/*/common.json
  - shared/i18n/locales/*/dreams.json
  - tests/e2e/openclaw-dreams.spec.ts
  - tests/e2e/developer-mode.spec.ts
  - tests/unit/dreams-page.test.tsx
  - tests/unit/openclaw-control-ui.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - ClawX no longer shows a Dreams navigation item or serves the /dreams route, including when developer mode is enabled.
  - ClawX continues to open the root OpenClaw Control UI from existing non-Dreams entry points.
  - Existing OpenClaw memory-core dreaming configuration and DREAMS.md data are not changed or deleted.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/openclaw-control-ui.test.ts
  - tests/e2e/developer-mode.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - No ClawX production source, route, navigation item, locale namespace, or dedicated Control UI parameter exposes Dreams.
  - The generic hostApi Gateway RPC and root Control UI paths remain available.
  - Gateway memory capability classification and OpenClaw memory-core configuration support remain unchanged.
  - README and harness guidance no longer describe the removed ClawX Dreams page or its tests.
docs:
  required: true
---

Use this task spec when removing or auditing the ClawX-owned Dreams UI and its dedicated renderer/Main bridge.
