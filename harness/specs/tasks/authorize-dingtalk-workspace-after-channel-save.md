---
id: authorize-dingtalk-workspace-after-channel-save
title: Offer DingTalk workspace OAuth after channel save
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let a ClawX user complete optional DingTalk Workspace OAuth immediately after saving a DingTalk bot, without requiring a terminal or blocking basic chat.
touchedAreas:
  - harness/specs/tasks/authorize-dingtalk-workspace-after-channel-save.md
  - harness/specs/tasks/upgrade-dingtalk-official-connector.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1-2-plugins.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - package.json
  - scripts/after-pack.cjs
  - scripts/bundle-openclaw-plugins.mjs
  - electron/utils/dingtalk-dws.ts
  - electron/utils/dingtalk-plugin-compat.ts
  - electron/utils/plugin-install.ts
  - electron/utils/openclaw-auth.ts
  - electron/services/channels-api.ts
  - electron/services/plugin-channel-activation.ts
  - electron/main/index.ts
  - shared/host-api/contract.ts
  - shared/types/channel.ts
  - src/lib/host-api.ts
  - src/pages/Channels/index.tsx
  - src/components/channels/ChannelConfigModal.tsx
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - tests/unit/dingtalk-dws.test.ts
  - tests/unit/dingtalk-plugin-compat.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/plugin-channel-activation.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-health-diagnostics.spec.ts
  - tests/e2e/channels-dingtalk-workspace-auth.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - After a new DingTalk bot is saved, ClawX checks the bundled dws authorization state and closes normally when it is already authorized.
  - When dws needs authorization, ClawX starts the desktop loopback OAuth flow, opens the official DingTalk authorization URL, and keeps the same modal in a waiting state without requiring terminal commands.
  - If the organization has not enabled CLI data access, the DWS browser flow must continue to its administrator-approval request page instead of terminating at a device-flow error.
  - The user may skip or cancel workspace authorization; the saved DingTalk chat connection remains available.
  - Completing authorization closes the modal with localized success feedback; expiration and CLI failures remain visible and can be retried.
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
  - tests/unit/dingtalk-dws.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/plugin-channel-activation.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-dingtalk-workspace-auth.spec.ts
acceptance:
  - Renderer starts, polls, and cancels DingTalk workspace OAuth only through hostApi.channels methods.
  - Main starts dws with argument arrays and DWS_CLIENT_ID / DWS_CLIENT_SECRET environment variables; secrets are not returned to Renderer or written to logs.
  - The loopback authorization URL (and a device code when emitted for compatibility) is parsed from bounded CLI output, authorization has a deadline, and closing, skipping, or quitting ClawX terminates the child process.
  - Workspace OAuth is optional and occurs only after DingTalk configuration has been durably saved; failure or cancellation never rolls back or marks basic chat unavailable.
  - Existing authorized dws installations do not prompt again.
  - The official connector's `__default__` runtime account is reconciled with ClawX's persisted `default` account without a false connection failure or redundant Gateway restart.
  - A live DingTalk Stream remains connected when the connector's optional `/contact/users/me` health probe returns 403 because the app lacks `Contact.User.Read`; the probe failure must not overwrite explicit `connected: true` runtime state.
  - All new user-facing strings have en, zh, ja, and ru translations and the flow has Electron E2E coverage.
docs:
  required: true
---

This task references `gateway-backend-communication` because the Renderer must not spawn dws or access DingTalk OAuth endpoints directly. The Main process owns the CLI lifecycle and exposes only bounded authorization state through the host API.
