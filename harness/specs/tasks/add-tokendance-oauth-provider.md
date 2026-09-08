---
id: add-tokendance-oauth-provider
title: Add TokenDance OAuth provider
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add TokenDance as an OpenAI-compatible provider with Authorization Code plus S256 PKCE API-key provisioning, stable ClawX attribution, and actionable key-recovery guidance.
touchedAreas:
  - harness/specs/tasks/add-tokendance-oauth-provider.md
  - harness/specs/tasks/restrict-tokendance-to-chinese-ui.md
  - harness/specs/rules/tokendance-oauth-provider.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/shared/providers/types.ts
  - electron/shared/providers/registry.ts
  - electron/utils/tokendance-oauth.ts
  - electron/utils/browser-oauth.ts
  - electron/utils/openclaw-auth.ts
  - electron/services/providers-api.ts
  - electron/services/providers/provider-validation.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/main/provider-model-sync.ts
  - electron/main/index.ts
  - shared/host-api/contract.ts
  - src/assets/providers/index.ts
  - src/assets/providers/tokendance.svg
  - src/lib/providers.ts
  - src/stores/providers.ts
  - src/components/settings/ProvidersSettings.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/pages/Chat/AcpErrorBanner.tsx
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - tests/unit/tokendance-oauth.test.ts
  - tests/unit/browser-oauth.test.ts
  - tests/unit/tokendance-openclaw-recovery.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/providers.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-store-init.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - In the Chinese interface, TokenDance appears in the add-provider dialog with its official website logo and OAuth Login and API Key choices; other interface languages do not offer it for new setup.
  - OAuth opens TokenDance in the system browser, returns through a random loopback callback, displays a localized success page, exchanges the one-time code with S256 PKCE, and stores only the resulting API key in ClawX secret storage.
  - Successful OAuth closes the setup dialog and shows feedback immediately while the provider list refreshes in the background, without repeating runtime default-model synchronization.
  - Deleting a provider removes its card optimistically while Main completes runtime and keychain cleanup.
  - TokenDance model and validation requests carry X-App-URL set to https://clawx.com.cn.
  - A TokenDance recovery response produces guidance for balance top-up, reauthorization, or periodic quota reset instead of being treated as an unclassified credential failure.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - openclaw-config-delivery
  - provider-default-invariant
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - ui-i18n-design-tokens
  - tokendance-oauth-provider
requiredTests:
  - tests/unit/tokendance-oauth.test.ts
  - tests/unit/browser-oauth.test.ts
  - tests/unit/tokendance-openclaw-recovery.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/providers.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-store-init.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - The OAuth authorization URL includes an encoded loopback callback, S256 challenge, app_url=https://clawx.com.cn, and key_name=ClawX.
  - The callback flow validates its opaque flow identifier, enforces a ten-minute timeout, supports cancellation, shows a localized success page instead of a blank callback, and sends the original verifier only to the TokenDance key exchange endpoint.
  - The exchanged API key is stored as an api_key secret even though the account auth mode records oauth_browser; the key is never written to logs, callback URLs, or renderer state.
  - In the Chinese interface, TokenDance uses the official website logo without dark-mode color inversion in the add-provider dialog; it is absent from that catalog in non-Chinese interfaces.
  - TokenDance runtime config uses https://tokendance.space/gateway/v1, openai-completions, qwen3.8-max as the default model, and X-App-URL=https://clawx.com.cn.
  - Manual TokenDance API keys use the same runtime attribution header.
  - Main-owned validation uses a minimal request with the configured model because TokenDance `/models` is public, reads only the documented TokenDance-Recovery-Action values, and returns the typed action for localized UI guidance.
  - The pinned OpenClaw runtime preserves documented recovery actions from failed model-response headers in its sanitized error text, and the Chat error banner replaces that marker with localized guidance.
  - OAuth success feedback and provider deletion update the UI immediately without waiting for follow-up runtime synchronization or snapshot reconciliation.
  - Browser OAuth emits each completion once, ignores duplicate start requests while a flow is active, and stale cancellation cleanup cannot clear a newer flow.
  - TokenDance records the account as default before emitting success, so Renderer confirmation does not trigger a second full runtime synchronization.
  - Renderer code adds no direct IPC or Gateway HTTP calls.
  - Focused tests, harness validation, communication replay, communication compare, typecheck, and lint pass.
docs:
  required: true
---

## Background

TokenDance is a multi-model gateway. Its desktop authorization flow creates an API key rather than a renewable OAuth access token. ClawX therefore needs to use browser OAuth for provisioning while persisting and synchronizing the result through the existing API-key secret path.

TokenDance identifies ClawX with the stable App URL `https://clawx.com.cn`. OAuth key creation receives that value as `app_url`, while every model request explicitly sends the same value in `X-App-URL` so request attribution overrides key attribution consistently.

## Scope

- Register TokenDance in shared, Main, and Renderer provider catalogs, with add-provider discovery restricted to the Chinese interface.
- Implement random-port loopback OAuth with Authorization Code and S256 PKCE.
- Exchange the code in Electron Main and store the returned key through the provider secret service.
- Configure OpenClaw with the TokenDance OpenAI Chat Completions endpoint, `qwen3.8-max` default model, and attribution header.
- Validate TokenDance keys with a minimal configured-model request, classify documented recovery headers, and localize the resulting guidance.
- Cover provider discovery, OAuth protocol details, attribution, recovery classification, and visible add-provider controls.

## Out of scope

- Storing a TokenDance product-owner API key in the repository.
- Querying the partner profit-share pricing endpoint without an externally supplied product-owner key.
- Building an in-app payment checkout or polling payment sessions.
- Supporting TokenDance non-chat media protocols in this provider preset.
