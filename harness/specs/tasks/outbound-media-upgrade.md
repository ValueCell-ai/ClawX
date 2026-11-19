---
id: outbound-media-upgrade
title: Preserve channel attachment delivery across the OpenClaw upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let bundled channels receive supported outbound attachments after upgrading a configuration that never specified a media limit.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/utils/plugin-install.ts
  - patches/**
  - tests/fixtures/outbound-media-upgrade.mjs
  - tests/fixtures/outbound-media-limit-http.mjs
  - tests/fixtures/outbound-media-plugin-uploads.mjs
  - pnpm-lock.yaml
  - tests/unit/outbound-media-upgrade.test.ts
  - tests/unit/outbound-media-limit-error.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - harness/specs/tasks/outbound-media-upgrade.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A user upgrading without an explicit limit can continue sending supported files through WeCom, DingTalk, Feishu and Weixin.
  - Existing explicit media limits and connector-specific file restrictions continue to apply.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - channel-plugin-migration-guards
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/outbound-media-upgrade.test.ts
  - tests/unit/outbound-media-limit-error.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
acceptance:
  - Exercise outbound delivery limit resolution for wecom, dingtalk (plugin id dingtalk-connector), feishu and openclaw-weixin with an upgraded configuration that omits media limits.
  - Preserve the established precedence of explicit settings, including a smaller account or channel limit.
  - Surface known media size errors through /tools/invoke with HTTP 413, a channel and byte counts where known. Keep private paths and other internal diagnostics out of the response.
  - Check an unknown channel retains the previous runtime default.
  - Keep connector validation, file-type selection and fallback behavior intact.
docs:
  required: true
---

The regression test uses synthetic configuration and payloads. Connector upload success against a live account requires separate evidence.
