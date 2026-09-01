---
id: model-management-consolidation
title: Consolidate developer model management into Models tabs
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consolidate developer-only Image Generation configuration under the Models page without changing its Main-owned OpenClaw configuration authority.
touchedAreas:
  - harness/specs/tasks/model-management-consolidation.md
  - harness/specs/tasks/image-generation-settings.md
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/settings/ImageGenerationSettings.tsx
  - src/pages/ImageGeneration/index.tsx
  - src/pages/Models/index.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/dashboard.json
  - shared/i18n/locales/zh/dashboard.json
  - shared/i18n/locales/ja/dashboard.json
  - shared/i18n/locales/ru/dashboard.json
  - tests/unit/models-page.test.tsx
  - tests/e2e/developer-mode.spec.ts
  - tests/e2e/image-generation-settings.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
expectedUserBehavior:
  - Models is the sole model-management architecture: Chat models is the default, and developer mode adds only the Image Generation tab.
  - Developer mode gates the Image Generation tab. The dedicated /image-generation route and sidebar item are absent whether developer mode is enabled or disabled.
  - Image Generation continues to configure its independent OpenAI-compatible image endpoint from Models -> Image Generation without changing normal chat-provider configuration.
  - Models accepts only chat and image-generation tab query values; Image Generation falls back to Chat models when developer mode is disabled, and unsupported or removed tab values use Chat models.
  - No Realtime Talk tab, settings panel, sidebar action, or deep link is part of model management.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec eslint src/components/settings/ImageGenerationSettings.tsx src/pages/Models/index.tsx tests/unit/models-page.test.tsx tests/e2e/developer-mode.spec.ts tests/e2e/image-generation-settings.spec.ts
  - pnpm exec vitest run tests/unit/models-page.test.tsx
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/developer-mode.spec.ts tests/e2e/image-generation-settings.spec.ts
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/model-management-consolidation.md --since d927ea3a
  - pnpm harness run --spec harness/specs/tasks/model-management-consolidation.md --since d927ea3a --dry-run
  - git diff --check
acceptance:
  - The Models tab architecture keeps Chat models as the default and contains Image Generation as its only developer-only tab.
  - When developer mode is disabled, Models renders its Chat provider configuration and Token Usage History as a single content layout without a Tabs root, list, or Chat trigger.
  - Token Usage History is visible only with Chat models; it is absent while Image Generation is selected and returns after Chat is selected.
  - The Image Generation route component, App route, and Sidebar image-generation item are deleted; no standalone image-generation page remains.
  - Removed Realtime Talk query values fall back to Chat models and no Talk UI or configuration path is restored.
  - Image Generation remains Main-owned through the existing typed host API and preserves its independent image endpoint configuration.
  - Image Generation retains its existing form behavior and selectors while rendering a recessed `bg-surface-input` settings surface with distinct raised `bg-surface-modal` endpoint, runtime/auth, and action cards.
  - The Image Generation Models tab label is localized in en, zh, ja, and ru; affected E2E and unit coverage proves developer gating, removed routes/navigation, and Models tab selection.
  - Focused Models unit coverage proves the no-Tabs Chat-only layout and Token Usage History tab scoping; developer-mode and image-generation Electron E2E coverage proves the corresponding navigation and visual hierarchy.
  - README and feature documentation consistently direct users to Models -> Image Generation and do not advertise removed model-management surfaces.
docs:
  required: true
---

## Scope

`gateway-backend-communication` is the primary scenario because this consolidation
repositions Main-owned OpenClaw image configuration in Renderer navigation.

No new Renderer-to-Main, Renderer-to-Gateway, or provider transport is introduced.
The existing typed Host API and Main-owned configuration transaction remain the
authority boundaries.
