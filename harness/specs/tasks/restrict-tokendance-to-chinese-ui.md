---
id: restrict-tokendance-to-chinese-ui
title: Restrict TokenDance discovery to the Chinese UI
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose TokenDance as an addable provider only when the ClawX interface language is Chinese, without breaking already configured TokenDance accounts.
touchedAreas:
  - harness/specs/tasks/restrict-tokendance-to-chinese-ui.md
  - harness/specs/tasks/add-tokendance-oauth-provider.md
  - harness/specs/rules/tokendance-oauth-provider.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/main/provider-model-sync.ts
  - src/lib/providers.ts
  - src/components/settings/ProvidersSettings.tsx
  - src/stores/providers.ts
  - src/assets/providers/index.ts
  - src/assets/providers/tokendance.svg
  - src/pages/Chat/AcpErrorBanner.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/providers.test.ts
  - tests/unit/tokendance-oauth.test.ts
  - tests/unit/tokendance-openclaw-recovery.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-store-init.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - TokenDance does not appear in the add-provider dialog when the interface language is English, Japanese, or Russian.
  - TokenDance appears in the add-provider dialog when the interface language is Chinese, including after switching languages in Settings.
  - Existing TokenDance accounts remain visible and manageable after the interface is switched away from Chinese.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - tokendance-oauth-provider
  - docs-sync
requiredTests:
  - tests/unit/providers.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Provider availability metadata marks TokenDance as Chinese-interface-only and handles normalized Chinese locale variants.
  - The add-provider catalog applies the current reactive interface language when filtering provider types.
  - Non-Chinese interfaces cannot start a new TokenDance configuration through the provider dialog.
  - Existing TokenDance provider cards and runtime behavior are not removed or disabled solely because the interface language changes.
  - Renderer code adds no direct IPC or Gateway HTTP calls.
  - README translations describe the language-gated TokenDance entry consistently.
  - Focused tests, harness validation, communication replay, communication compare, typecheck, and lint pass.
docs:
  required: true
---

## Scope

- Add declarative interface-language availability metadata to provider UI definitions.
- Mark TokenDance as available for discovery only in Chinese.
- Filter the add-provider catalog using the active interface language.
- Cover English-hidden and Chinese-visible behavior in Electron E2E tests.
- Preserve management and runtime behavior for TokenDance accounts that were configured previously.

## Out Of Scope

- Removing TokenDance from Main or shared provider registries.
- Deleting, disabling, or migrating existing TokenDance accounts when users change language.
- Changing TokenDance OAuth, validation, recovery, or runtime transport behavior.
- Removing TokenDance recovery translations needed by previously configured accounts.
