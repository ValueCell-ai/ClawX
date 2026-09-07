---
id: validate-feishu-credentials-before-save
title: Validate Feishu credentials before save and keep probe failures visible
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Reject Feishu App ID / App Secret pairs that Feishu itself rejects (including the App ID pasted into the App Secret field) inside the channel modal instead of persisting them, and keep a failed channels.status probe visible in the Channels view until a later probe succeeds, so a Feishu bot that can never receive events is no longer shown as Connected.
touchedAreas:
  - electron/utils/channel-config.ts
  - electron/services/channels-api.ts
  - shared/host-api/contract.ts
  - src/components/channels/ChannelConfigModal.tsx
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-feishu-credential-validation.spec.ts
  - harness/specs/tasks/validate-feishu-credentials-before-save.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/scenarios/gateway-backend-communication.md
expectedUserBehavior:
  - Saving a Feishu account whose App Secret equals its App ID is rejected in the modal without contacting Feishu, with a localized hint pointing at Credentials & Basic Info.
  - Saving a Feishu account requests a tenant_access_token through the Main-process proxy-aware fetch; a Feishu rejection or connection failure keeps the modal open with the Feishu message instead of writing the config.
  - Valid Feishu credentials save exactly as before; the Validate Configuration button is available for Feishu like other token channels.
  - A channels.status probe failure for an account stays visible as Error with its message on subsequent cached (probe=0) polls instead of flipping back to Connected.
  - While a probe failure is remembered, cached polls are upgraded to a probe at most every 30 seconds so a channel fixed outside the modal recovers without a manual refresh.
  - Saving new credentials for the account or deleting it forgets the remembered probe failure immediately.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - channel-plugin-migration-guards
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
requiredTests:
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-feishu-credential-validation.spec.ts
acceptance:
  - validateChannelCredentials('feishu') returns valid=false with errorCodes feishuAppIdRequired / feishuAppSecretRequired / feishuAppSecretEqualsAppId before any network call.
  - validateChannelCredentials('feishu') POSTs to <origin>/open-apis/auth/v3/tenant_access_token/internal via proxyAwareFetch, honours domain=lark, tries open.feishu.cn then open.larksuite.com when domain is unset, and maps a non-zero code to feishuRejected and a thrown fetch to feishuConnectionError without throwing.
  - ChannelConfigModal runs credential validation for every token channel, localizes errorCodes through channels:dialog.validationErrors.*, and does not call saveConfig when validation fails.
  - buildChannelAccountsView remembers per-account probe failures from probe=1 snapshots, overlays lastError on probe=0 snapshots, upgrades a cached request to probe=1 once a remembered failure is at least 30 seconds old, and clears entries on a successful probe, saveConfig, or deleteConfig.
docs:
  required: false
---

Use this task spec when a plugin-backed channel keeps its account `running`
even though the upstream service rejects its credentials, so ClawX has to
verify credentials itself before persisting them and must not let a single
successful non-probe poll hide a probe failure.

This also references `gateway-backend-communication` because both the
credential check and the probe memory are Main-owned: the renderer only
calls `hostApi.channels.validateCredentials` / `channels.accounts` and never
contacts Feishu or Gateway HTTP directly.
