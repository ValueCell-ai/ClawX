---
id: image-generation-settings
title: Models page image generation settings and host API
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose global agents.defaults.imageGenerationModel configuration on the Models page with per-agent auth visibility, optional auto-sync from default provider, and CLI-backed test generation via Main-process host routes.
touchedAreas:
  - harness/specs/tasks/image-generation-settings.md
  - electron/utils/openclaw-image-generation-runtime.ts
  - electron/utils/openclaw-image-generation.ts
  - electron/api/routes/media.ts
  - electron/api/server.ts
  - electron/utils/store.ts
  - electron/services/providers/provider-runtime-sync.ts
  - src/lib/image-generation.ts
  - src/components/settings/ImageGenerationSettings.tsx
  - src/pages/Models/index.tsx
  - src/i18n/locales/*/dashboard.json
  - tests/unit/openclaw-image-generation.test.ts
  - tests/e2e/image-generation-settings.spec.ts
expectedUserBehavior:
  - Models page shows Image Generation section below AI Providers with primary model, fallbacks, timeout, auto-sync toggle, per-agent auth table, and test generate button.
  - Saving settings writes openclaw.json agents.defaults.imageGenerationModel and marks imageGenUserEdited so provider auto-sync stops until re-enabled.
  - Changing default provider auto-updates primary image model when imageGenAutoSyncEnabled is true and user has not manually saved image settings.
  - Test generate calls OpenClaw in-process generateImage runtime with the selected agent auth directory (no CLI subprocess).
requiredProfiles:
  - fast
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/openclaw-image-generation.test.ts
  - tests/e2e/image-generation-settings.spec.ts
acceptance:
  - Renderer uses hostApiFetch only (src/lib/image-generation.ts); no direct Gateway HTTP or ipcRenderer from pages.
  - GET/PUT /api/media/image-generation and POST /api/media/image-generation/test are handled in Main process.
  - Unit tests cover model ref parsing, config read/write, and auto-sync gating.
  - E2E verifies image-generation-settings test ids on Models page.
docs:
  required: false
---

## Background

OpenClaw exposes image generation via the `image_generate` tool using global
`agents.defaults.imageGenerationModel` while credentials remain per-agent under
`~/.openclaw/agents/{id}/agent/auth-profiles.json`.

ClawX already syncs chat defaults on provider switch; this task adds parallel
support for image generation from the Models page.
