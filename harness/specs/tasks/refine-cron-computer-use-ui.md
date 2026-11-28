---
id: refine-cron-computer-use-ui
title: Refine scheduled tasks and Computer Use management UI
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Improve the visibility of task and permission actions using existing management layouts without changing host behavior.
touchedAreas:
  - harness/specs/tasks/refine-cron-computer-use-ui.md
  - src/components/ui/config-dialog-content.tsx
  - src/components/settings/ModelConfigDialog.tsx
  - src/pages/Cron/index.tsx
  - src/pages/ComputerUse/index.tsx
  - shared/i18n/locales/en/common.json
  - shared/i18n/locales/zh/common.json
  - shared/i18n/locales/ja/common.json
  - shared/i18n/locales/ru/common.json
  - shared/i18n/locales/en/cron.json
  - shared/i18n/locales/zh/cron.json
  - shared/i18n/locales/ja/cron.json
  - shared/i18n/locales/ru/cron.json
  - tests/e2e/cron-schedule.spec.ts
  - tests/e2e/cron-card-long-title.spec.ts
  - tests/e2e/computer-use.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A compact summary leaves more room for tasks and task actions remain visible.
  - The scheduling dialog uses the shared configuration layout with a fixed footer and restores focus to its opener.
  - The Computer Use page shows separate runtime and permission states, with permission help when access is missing.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - ui-i18n-design-tokens
  - renderer-main-boundary
  - backend-communication-boundary
  - local-computer-use
  - comms-regression
  - e2e-parallel-isolation
requiredTests:
  - tests/e2e/cron-schedule.spec.ts
  - tests/e2e/cron-card-long-title.spec.ts
  - tests/e2e/computer-use.spec.ts
acceptance:
  - Switching between recurring and one-time schedules preserves access to the save and cancel actions.
  - Users can reach task editing with the keyboard and Escape returns focus to the opener.
  - Permission requests still require an enabled feature and an explicit action; completed grants hide the redundant request controls.
docs:
  required: true
---

Use the existing typed host APIs for scheduling, Computer Use status, opt-in, retries and permission requests.
