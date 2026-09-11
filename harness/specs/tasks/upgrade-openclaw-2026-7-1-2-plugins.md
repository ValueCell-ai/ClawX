---
id: upgrade-openclaw-2026-7-1-2-plugins
title: Upgrade bundled channel plugins on OpenClaw 2026.7.1-2
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Take the newest official channel plugins that still declare compatibility with the pinned OpenClaw 2026.7.1-2 runtime, without changing ClawX channel identities or upgrading Discord, WhatsApp, or QQBot past that core.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - electron/utils/plugin-install.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-install-index.test.ts
  - harness/specs/tasks/upgrade-openclaw-2026-7-1.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1-2-plugins.md
expectedUserBehavior:
  - Existing DingTalk, WeCom, Feishu, and personal WeChat channel configuration stays usable after the bundled plugin version bump.
  - ClawX still registers DingTalk as the remapped `dingtalk` identity, WeCom as the legacy-compatible `wecom` identity, and Feishu as path-owned `openclaw-lark`.
  - Discord, WhatsApp, and QQBot remain on 2026.7.1 because newer official lines require a newer OpenClaw core.
  - OpenClaw itself stays pinned at 2026.7.1-2.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - DingTalk is pinned to official `@dingtalk-real-ai/dingtalk-connector@0.8.25` remapped onto `dingtalk`, WeCom to 2026.8.17, Open Lark to 2026.7.16, and personal WeChat to 2.4.8.
  - Discord, WhatsApp, and QQBot remain pinned to 2026.7.1.
  - Each upgraded plugin still declares an OpenClaw peer that includes 2026.7.1-2.
  - Upstream WeCom and Open Lark manifest IDs stay `wecom-openclaw-plugin` and `openclaw-lark` so ClawX compatibility mappings do not change.
  - The lockfile no longer retains the superseded plugin versions.
docs:
  required: false
---

Use this task spec when bumping official bundled channel plugins while the
OpenClaw runtime remains on 2026.7.1-2. Do not use it for a core upgrade;
Discord and WhatsApp latest lines require matching newer OpenClaw peers.
