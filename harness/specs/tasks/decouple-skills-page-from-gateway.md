---
id: decouple-skills-page-from-gateway
title: Decouple Skills page from gateway RPC and remove built-in public ClawHub marketplace
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make Skills usable when Gateway is stopped or starting by loading local skills from the Main process first, writing skill enabled state directly to openclaw.json, and removing the built-in public ClawHub marketplace dependency.
touchedAreas:
  - .gitignore
  - harness/specs/tasks/decouple-skills-page-from-gateway.md
  - electron/api/routes/skills.ts
  - electron/gateway/clawhub.ts
  - electron/main/index.ts
  - electron/services/skills/**
  - electron/utils/skill-config.ts
  - electron/extensions/builtin/index.ts
  - electron/extensions/builtin/clawhub-marketplace.ts
  - electron/extensions/types.ts
  - clawx-extensions.json
  - package.json
  - pnpm-lock.yaml
  - playground/clawhub-skillshub-gateway-analysis.md
  - playground/skills-page-decoupling-execution-plan.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - src/pages/Skills/index.tsx
  - src/stores/skills.ts
  - src/types/skill.ts
  - shared/i18n/locales/en/skills.json
  - shared/i18n/locales/zh/skills.json
  - shared/i18n/locales/ja/skills.json
  - shared/i18n/locales/ru/skills.json
  - scripts/agent-browser/skills-local-first-smoke.sh
  - scripts/bundle-openclaw.mjs
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/unit/clawhub-service.test.ts
  - tests/unit/local-skill-service.test.ts
  - tests/unit/skill-config-bundled-defaults.test.ts
  - tests/unit/skills-errors.test.ts
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - tests/unit/skills-store-fetch-parallel.test.ts
expectedUserBehavior:
  - Skills renders local managed/workspace/.agents skills even when Gateway is stopped.
  - Skills refreshes local data immediately and merges Gateway runtime status later when available.
  - Enabling and disabling skills updates openclaw.json without requiring Gateway RPC.
  - Managed skill config writes go through Host API instead of direct Gateway RPC.
  - Community builds do not expose the built-in public ClawHub marketplace.
  - Enterprise SkillsHub marketplace providers can still plug into the existing capability/search/install routes.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm run typecheck
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/unit/clawhub-service.test.ts
  - tests/unit/local-skill-service.test.ts
  - tests/unit/skill-config-bundled-defaults.test.ts
  - tests/unit/skills-errors.test.ts
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - tests/unit/skills-store-fetch-parallel.test.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Skills page first loads /api/skills/local and remains usable when Gateway is stopped.
  - Gateway skills.status becomes a best-effort runtime merge, not a hard dependency for initial rendering.
  - Enabling/disabling skills writes skills.entries.<skillKey>.enabled in openclaw.json via Host API.
  - Gateway-offline local scan includes the allowlisted bundled OpenClaw skill `skill-creator`.
  - Non-allowlisted bundled OpenClaw skills are physically trimmed from the active OpenClaw runtime (dev + packaged), and stale openclaw.json entries for those removed bundled skills are pruned.
  - Packaged OpenClaw bundles physically keep only the allowlisted bundled skill `skill-creator`.
  - Uninstalling a managed skill removes skills.entries.<skillKey> instead of preserving stale config.
  - Without an extension marketplace provider, /api/clawhub/capability reports local-only and install/search are unavailable.
  - package.json no longer depends on npm clawhub.
docs:
  required: false
---

Use this task spec when changing Skills page loading, config writes, or marketplace behavior across renderer/Main/Gateway boundaries.
