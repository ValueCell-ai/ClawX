---
id: computer-use-key-vision-fix
title: Repair computer key chords and model input metadata
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve Command modifiers across the CUA boundary and infer missing model input metadata without overriding explicit text-only models.
touchedAreas:
  - resources/skills/computer-use/**
  - electron/utils/openclaw-auth.ts
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/openclaw-auth.test.ts
  - harness/specs/tasks/computer-use-key-vision-fix.md
  - harness/specs/rules/local-computer-use.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - harness/reference/computer-use.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - src/pages/ComputerUse/index.tsx
  - shared/i18n/locales/*/common.json
  - tests/e2e/computer-use.spec.ts
  - tests/unit/computer-use-api.test.ts
  - tests/unit/plugin-install.test.ts
expectedUserBehavior:
  - Native CLI guidance uses the pinned cmd modifier for Command/Win chords and verifies shortcut effects rather than assuming acknowledgment proves success.
  - Provider synchronization fills missing image-input metadata for recognized vision models while preserving explicit input declarations.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - provider-model-metadata-preservation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/computer-use-api.test.ts
  - tests/e2e/computer-use.spec.ts
acceptance:
  - Native CLI guidance uses cmd rather than meta for CUA press_key; there is no custom computer-tool alias mapper.
  - Existing custom provider rows without input are repaired on sync, as are newly written and legacy agent models.json rows.
  - Explicit text-only input and unknown-model conservative fallback remain intact.
  - A returned permission request that leaves access ungranted shows actionable feedback without promising a native prompt; guidance accounts for development terminal or IDE attribution.
  - No permission bypass, automatic input replay, or unrelated screenshot capture is introduced.
  - Native workflows use a unique explicit non-default session across accepting CLI calls and never blindly replay input after unknown completion or a generation change.
  - Historical computer chat presentation and independent provider vision-metadata fixes remain without reinstalling or registering the retired plugin.
docs:
  required: true
---

# Diagnosis

The old computer-tool alias mapper, per-MCP-transport lease fix, and plugin mirror
version bump are historical. `harness/specs/tasks/cua-driver-cli.md` supersedes
those adapter requirements and the removed plugin test. The provider input
metadata repair, permission feedback, and no-replay principles remain active;
the requirements above refer to their current native CLI integration.

`harness/specs/tasks/cua-025-upgrade.md` supersedes earlier 0.21.0 version-specific
requirements with the SDK/driver/official Skill 0.25.0 contract. The old shortcut
diagnosis remains historical evidence, not proof of native 0.25.0 shortcut
delivery; provider metadata and permission boundaries above are unchanged.

See harness/reference/computer-use.md for the pinned driver contract and live
verification limitations. Native shortcut verification requires the user's OS
grants; automated tests must not inject desktop input.
