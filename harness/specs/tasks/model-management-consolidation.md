---
id: model-management-consolidation
title: Consolidate developer model management into Models tabs
scenario: gateway-backend-communication
scenarios:
  - realtime-talk
taskType: runtime-bridge
intent: Consolidate developer-only Image Generation and Realtime Talk configuration under the Models page without changing their Main-owned OpenClaw configuration or Gateway Relay authority.
touchedAreas:
  - harness/specs/tasks/model-management-consolidation.md
  - harness/reference/realtime-talk.md
  - harness/specs/rules/realtime-talk-openclaw-authority.md
  - harness/specs/scenarios/realtime-talk.md
  - harness/specs/tasks/add-realtime-talk.md
  - harness/specs/tasks/image-generation-settings.md
  - docs/plans/2026-08-30-model-management-consolidation.md
  - docs/plans/2026-08-30-model-tabs-polish.md
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
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
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
  - Models is the sole model-management architecture: Chat models is the default tab, and developer mode adds Image Generation and Realtime Talk tabs.
  - Developer mode gates both non-chat Models tabs. The dedicated /image-generation route and sidebar item are absent whether developer mode is enabled or disabled.
  - Image Generation continues to configure its independent OpenAI-compatible image endpoint from Models -> Image Generation without changing normal chat-provider configuration.
  - Realtime Talk configuration is available only from Models -> Realtime Talk; the Settings Talk panel is removed.
  - The sidebar Talk action navigates an unavailable or failed-to-start relay to /models?tab=realtime-talk, where catalog readiness and provider/model configuration remain available.
  - Models accepts only chat, image-generation, and realtime-talk tab query values; non-chat tab queries fall back to Chat models when developer mode is disabled, and unsupported values use Chat models.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - realtime-talk-openclaw-authority
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec eslint src/components/settings/ImageGenerationSettings.tsx src/pages/Models/index.tsx tests/unit/models-page.test.tsx tests/e2e/developer-mode.spec.ts tests/e2e/image-generation-settings.spec.ts
  - pnpm exec vitest run tests/unit/models-page.test.tsx
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-model-picker.spec.ts tests/e2e/developer-mode.spec.ts tests/e2e/image-generation-settings.spec.ts
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/model-management-consolidation.md --since d927ea3a
  - pnpm harness run --spec harness/specs/tasks/model-management-consolidation.md --since d927ea3a --dry-run
  - git diff --check
acceptance:
  - The Models tab architecture keeps Chat models as the default and contains Image Generation and Realtime Talk only when developer mode is enabled.
  - When developer mode is disabled, Models renders its Chat provider configuration and Token Usage History as a single content layout without a Tabs root, list, or Chat trigger.
  - Token Usage History is visible only with Chat models; it is absent while the Image Generation or Realtime Talk developer tab is selected and returns after Chat is selected.
  - The Image Generation route component, App route, and Sidebar image-generation item are deleted; no standalone image-generation page remains.
  - The Settings Talk panel and its section-query focus handling are removed; Talk configuration renders only inside Models -> Realtime Talk.
  - The Sidebar Talk unavailable and start-failure paths navigate to /models?tab=realtime-talk, and the Models query parser permits that deep link only while developer mode is enabled.
  - Realtime Talk remains Gateway Relay-only, Main-owned, catalog-validated, and transient as defined by the realtime-talk scenario and realtime-talk-openclaw-authority rule. The Models tab saves only provider/model and opens the resolved OpenClaw config file for speaker voice and other provider-specific fields.
  - Image Generation remains Main-owned through the existing typed host API and preserves its independent image endpoint configuration.
  - Image Generation retains its existing form behavior and selectors while rendering a recessed `bg-surface-input` settings surface with distinct raised `bg-surface-modal` endpoint, runtime/auth, and action cards.
  - New Models tab labels are localized in en, zh, ja, and ru; affected E2E and unit coverage proves developer gating, removed routes/navigation, Models tab selection, and Talk query navigation.
  - Focused Models unit coverage proves the no-Tabs Chat-only layout and Token Usage History tab scoping; developer-mode and image-generation Electron E2E coverage proves the corresponding navigation and visual hierarchy.
  - README and feature documentation consistently direct users to Models -> Image Generation and Models -> Realtime Talk.
docs:
  required: true
---

## Scope

`gateway-backend-communication` is the primary scenario because this consolidation
repositions Main-owned OpenClaw configuration surfaces in Renderer navigation.
`realtime-talk` is supplemental scope because the Realtime Talk tab, its catalog
readiness routing, and its OpenClaw authority contract move together.

No new Renderer-to-Main, Renderer-to-Gateway, or provider transport is introduced.
The existing typed Host API, Main-owned configuration transaction, and Gateway Relay
remain the authority boundaries.
