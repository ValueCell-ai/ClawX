---
id: computer-use-key-vision-fix
title: Repair computer key chords and model input metadata
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve Command modifiers across the CUA boundary and infer missing model input metadata without overriding explicit text-only models.
touchedAreas:
  - resources/openclaw-plugins/clawx-cua-computer/computer-tool.mjs
  - resources/openclaw-plugins/clawx-cua-computer/mcp-client.mjs
  - resources/openclaw-plugins/clawx-cua-computer/package.json
  - electron/utils/openclaw-auth.ts
  - tests/unit/clawx-cua-plugin.test.ts
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
  - Meta and Command chords retain the Command modifier on macOS and Windows.
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
  - tests/unit/clawx-cua-plugin.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/computer-use-api.test.ts
  - tests/e2e/computer-use.spec.ts
acceptance:
  - The computer tool sends cmd rather than meta to CUA press_key, including Meta+Space.
  - Existing custom provider rows without input are repaired on sync, as are newly written and legacy agent models.json rows.
  - Explicit text-only input and unknown-model conservative fallback remain intact.
  - A returned permission request that leaves access ungranted shows actionable feedback without promising a native prompt; guidance accounts for development terminal or IDE attribution.
  - No permission bypass, automatic input replay, or unrelated screenshot capture is introduced.
  - Each new MCP transport uses a fresh CUA session label; reconnection must not reuse another transport's lease or replay failed inputs.
  - The bundled plugin version changes so existing 0.1.0 mirrors receive the fixes through normal installation.
docs:
  required: true
---

# Diagnosis

See harness/reference/computer-use.md for the pinned driver contract and live
verification limitations. Native shortcut verification requires the user's OS
grants; automated tests must not inject desktop input.
