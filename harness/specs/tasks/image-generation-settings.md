---
id: image-generation-settings
title: Developer-only image generation settings and host API
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose global agents.defaults.imageGenerationModel configuration on a developer-only Image Generation page with per-agent auth visibility, independent OpenAI-compatible image endpoint settings, and runtime-backed test generation via Main-process host routes.
touchedAreas:
  - harness/specs/tasks/image-generation-settings.md
  - electron/utils/openclaw-image-generation-runtime.ts
  - electron/utils/openclaw-image-generation.ts
  - electron/utils/openclaw-image-relay-constants.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/plugin-install.ts
  - resources/openclaw-plugins/clawx-openai-image/index.mjs
  - resources/openclaw-plugins/clawx-openai-image/openclaw.plugin.json
  - resources/openclaw-plugins/clawx-openai-image/package.json
  - scripts/bundle-openclaw.mjs
  - scripts/patch-openclaw-image-b64-json.mjs
  - package.json
  - electron/services/media-api.ts
  - electron/utils/store.ts
  - electron/services/providers/provider-runtime-sync.ts
  - src/lib/image-generation.ts
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/settings/ImageGenerationSettings.tsx
  - src/pages/ImageGeneration/index.tsx
  - src/pages/Models/index.tsx
  - shared/i18n/locales/*/common.json
  - shared/i18n/locales/*/dashboard.json
  - tests/unit/openclaw-image-generation.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/image-generation-settings.spec.ts
  - tests/e2e/app-smoke.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Models page no longer embeds Image Generation; developer mode shows a dedicated Image Generation sidebar page alongside Skills, Cron, and Dreams.
  - Saving settings writes openclaw.json agents.defaults.imageGenerationModel from the explicit custom image endpoint form; default chat provider changes do not auto-sync image models.
  - The custom image endpoint is always the page's configuration target; no extra enable/disable switch is shown before Base URL/model/API key fields.
  - Saving the OpenAI-compatible image endpoint writes a ClawX-owned provider (`clawx-openai-image`) and auth profile, enables `request.allowPrivateNetwork` for trusted custom endpoints, and leaves `models.providers.openai` untouched so chat continues to use the regular OpenAI provider.
  - Test generate calls OpenClaw in-process generateImage runtime with the selected agent auth directory (no CLI subprocess).
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/openclaw-image-generation.test.ts
  - tests/e2e/image-generation-settings.spec.ts
acceptance:
  - Renderer uses typed hostApi media methods only (src/lib/image-generation.ts); no direct Gateway HTTP or ipcRenderer from pages.
  - Image generation settings and test actions are handled in Main process services.
  - Unit tests cover model ref parsing, config read/write, custom endpoint model mapping, private-network endpoint opt-in, and the independent image endpoint not mutating `models.providers.openai`.
  - E2E verifies the Image Generation page is hidden until developer mode is enabled, is not embedded in Models, and exposes the custom endpoint controls.
docs:
  required: false
---

## Background

OpenClaw exposes image generation via the `image_generate` tool using global
`agents.defaults.imageGenerationModel` while credentials remain per-agent under
`~/.openclaw/agents/{id}/agent/auth-profiles.json`. ClawX's OpenAI-compatible
image endpoint uses a separate `clawx-openai-image` provider/plugin so image
base URL and API key can differ from the normal `openai` chat provider.

ClawX syncs chat defaults on provider switch, but image generation is configured independently from its developer-only Image Generation page and is never auto-synced from the default chat provider.
