---
id: builtin-computer-use-skill
title: Built-in computer-use guidance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ship original opt-in desktop guidance through the existing built-in skill installer and picker without changing tool authorization.
touchedAreas:
  - resources/skills/computer-use/**
  - electron/utils/skill-config.ts
  - electron/main/index.ts
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron-builder.yml
  - package.json
  - pnpm-workspace.yaml
  - resources/openclaw-plugins/clawx-cua-computer/**
  - scripts/after-pack.cjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/download-cua-driver.mjs
  - shared/**
  - src/**
expectedUserBehavior:
  - Fresh dev and packaged installations discover computer-use in the existing skill picker.
  - Explicit selection inserts /computer-use without enabling Computer Use or operating the desktop.
  - Existing same-name user skills and disabled preferences are preserved.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/unit/clawx-cua-plugin.test.ts
  - tests/unit/computer-use-settings.test.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - The English skill is original, concise, and matches the bundled computer tool schema and error behavior.
  - First-party resources ship locally without a third-party manifest entry or runtime download.
  - Installation and selection never mutate computer-use policy or OS permissions.
  - Guidance covers screenshot pixels, focus, serialized actions, uncertain completion, untrusted screen content, and confirmation boundaries.
  - Tests exercise real resource installation and discovery and never perform desktop input.
docs:
  required: true
---

# Built-in Computer Use

See `harness/reference/computer-use-skill.md` for public research sources,
original synthesis decisions, packaging paths, and validation limits.

Harness validation covers the full branch diff, including the preceding bundled
driver and opt-in tasks. Their packaging, plugin, shared, and renderer paths are
listed above for that inherited scope; this task does not alter their authorization.
