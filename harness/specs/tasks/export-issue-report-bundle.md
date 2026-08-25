---
id: export-issue-report-bundle
title: Export a multi-conversation issue report bundle
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let a user open an issue-report workflow from Settings, review its contents, select one or more conversations, and export their transcripts with sanitized configuration and diagnostic logs.
touchedAreas:
  - harness/specs/tasks/export-issue-report-bundle.md
  - harness/specs/rules/issue-report-export-safety.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - package.json
  - pnpm-lock.yaml
  - shared/host-api/contract.ts
  - electron/services/diagnostics-api.ts
  - electron/services/issue-report-api.ts
  - electron/extensions/builtin/diagnostics.ts
  - src/lib/host-api.ts
  - src/components/settings/IssueReportExport.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/issue-report-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/settings-issue-report.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Settings contains an always-visible Support section with an issue-report export button.
  - Activating the button opens a localized dialog that lists transcripts, sanitized OpenClaw configuration, diagnostic logs, and the manifest as bundle contents.
  - The user can select individual conversations or select all available conversations.
  - Export creates a ZIP on the operating system Desktop directory containing every selected JSONL transcript, a sanitized OpenClaw JSON configuration when available, logs, and a manifest.
  - After success, the dialog displays the full ZIP path and offers a Show in Folder action.
  - Stale selections with missing transcripts are skipped and reported; export fails if no selected transcript is available or if a selected path is unsafe.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - diagnostics-trace-safety
  - issue-report-export-safety
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/issue-report-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/settings-issue-report.spec.ts
acceptance:
  - Renderer invokes diagnostics.exportIssueReport only through src/lib/host-api.ts.
  - Main requires at least one session key and resolves every available selected transcript under its matching agent sessions directory without following an escaping symlink.
  - The ZIP contains every available selected transcript, a recursively redacted OpenClaw config when present, available ClawX and OpenClaw log files with common credential forms redacted, and a manifest that reports stale selections.
  - Archive entry names do not expose source absolute paths.
  - Export writes a uniquely named ZIP atomically to the Desktop directory on macOS and Windows and returns its absolute path.
  - The success state visibly renders the path and can reveal it in the platform file manager.
  - Settings shows the bundle contents before export and supports individual and select-all conversation selection.
  - All new UI strings exist in English, Chinese, Japanese, and Russian.
docs:
  required: true
  reason: This changes the user-visible issue-report workflow and diagnostics export payload.
references:
  - harness/specs/scenarios/gateway-backend-communication.md
---

## Scope

- Add an issue-report entry in Settings and a dialog that previews bundle contents.
- Allow one, multiple, or all available conversations to be selected.
- Send only selected session keys through the typed Host API; all file access remains in Main.
- Include selected transcripts, sanitized OpenClaw config, available application/runtime logs, and a manifest.
- Show and reveal the resulting ZIP path.

## Out Of Scope

- Uploading or transmitting the archive.
- Editing or deleting source transcripts, configuration, or logs.
- Guaranteeing removal of secrets manually pasted into conversation content or arbitrary log messages.
