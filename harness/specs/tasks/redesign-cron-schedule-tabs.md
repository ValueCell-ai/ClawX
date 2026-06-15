---
id: redesign-cron-schedule-tabs
title: Redesign cron task schedule into recurring/once tabs
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the cron task dialog's preset-template grid with a recurring/once tabbed schedule builder, and let the Main-process cron host route accept both cron expressions and structured Gateway CronSchedule objects (including one-time `at` schedules) so single-run tasks can be created.
touchedAreas:
  - harness/specs/tasks/redesign-cron-schedule-tabs.md
  - src/pages/Cron/index.tsx
  - shared/types/cron.ts
  - electron/services/cron-api.ts
  - src/stores/cron.ts
  - tests/unit/cron-store-fetch-dedupe.test.ts
  - shared/i18n/locales/en/cron.json
  - shared/i18n/locales/zh/cron.json
  - shared/i18n/locales/ja/cron.json
  - shared/i18n/locales/ru/cron.json
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-skill-picker.spec.ts
  - tests/e2e/cron-schedule.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - The Create/Edit Task dialog no longer shows the preset schedule buttons; Schedule is split into a "Recurring" tab and a "Once" tab.
  - The Recurring tab exposes a frequency dropdown (Hourly, Daily, Weekdays, Weekly, Custom); Daily/Weekdays show a time, Weekly adds a weekday selector, Custom shows a cron expression field.
  - The Once tab exposes a time field and a date field that displays the weekday for the chosen date, and creates a single-run task.
  - The Once tab rejects a date/time in the past on save (date field also enforces a minimum of today), so a one-time task can only be scheduled for the future.
  - One-time ("at") tasks are auto-cleared by the OpenClaw runtime after they run (OpenClaw defaults `deleteAfterRun` to true for `at` schedules); ClawX does not try to keep them as paused records.
  - After a one-time task auto-deletes, it disappears from the list on the next refresh: the renderer treats `cron.list` as authoritative and only preserves a locally-cached job the Gateway omits when it was created within a short grace window (optimistic-create race bridge), so deleted jobs are not resurrected.
  - The time fields use a custom 24-hour two-column picker (hours 0-23 / minutes 0-59) with a neutral grey selection and no AM/PM controls.
  - The next-run preview continues to reflect the currently configured schedule.
  - Editing an existing job restores the correct tab and fields from its stored schedule.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-schedule.spec.ts
  - pnpm run typecheck
  - pnpm test
acceptance:
  - Renderer builds the schedule payload (cron string for recurring, CronSchedule `at` object for once) and sends it through hostApi.cron.create/update; no direct Gateway calls or ipcRenderer from the page.
  - CronJobCreateInput/CronJobUpdateInput.schedule accept `string | CronSchedule`, and the Main cron host route normalizes a string to `{ kind: 'cron', expr }` while passing through structured CronSchedule objects to the Gateway.
  - Unit tests cover schedule payload normalization for cron, recurring presets, and one-time `at` schedules.
  - E2E verifies the recurring/once tab interaction and that the dialog opens with the new schedule builder instead of preset buttons.
docs:
  required: false
---

## Background

The cron task dialog previously offered a fixed grid of preset cron strings plus a
"use custom cron" toggle. This task replaces that with a tabbed schedule builder
(Recurring vs Once) so users can configure hourly/daily/weekday/weekly/custom
recurrences or a single-run task with an explicit date and time.

One-time tasks require a Gateway `{ kind: 'at', at }` schedule. The ClawX cron host
route previously hardcoded `{ kind: 'cron', expr }` on create, so this task widens the
create/update inputs to accept a structured `CronSchedule` and normalizes plain cron
strings into the cron object form.

## Out of scope

- Changing the Gateway cron RPC contract itself (cron.add/cron.update already accept
  the structured schedule kinds returned by cron.list).
- Adding interval (`every`) scheduling UI; only cron-based recurrences and one-time
  `at` schedules are exposed.
