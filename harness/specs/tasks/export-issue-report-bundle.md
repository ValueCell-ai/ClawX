---
id: export-issue-report-bundle
title: Export a multi-conversation issue report bundle
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let a user quickly open an issue-report workflow from the sidebar or Settings and export sanitized configuration and diagnostic logs, optionally including selected conversation transcripts.
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
  - src/components/layout/Sidebar.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/issue-report-api.test.ts
  - tests/unit/issue-report-export.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/settings-issue-report.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The sidebar contains an always-visible issue-report shortcut immediately below Settings, using a bug icon and an accessible icon-only form when collapsed.
  - Settings retains an issue-report export button under About and help.
  - Activating either entry opens the same localized dialog that lists transcripts, sanitized OpenClaw configuration, diagnostic logs, and the manifest as bundle contents.
  - The user can select individual conversations or select all available conversations, but conversation selection is optional.
  - Export remains available when no conversations exist or none are selected.
  - Export creates a ZIP on the operating system Desktop directory containing every selected JSONL transcript, if any, a sanitized OpenClaw JSON configuration when available, logs, and a manifest.
  - After success, the dialog displays the full ZIP path and offers a Show in Folder action.
  - Stale selections with missing transcripts are skipped and reported; the diagnostics-only export still succeeds if no selected transcript is available, while an unsafe selected path fails the export.
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
  - tests/unit/issue-report-export.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/settings-issue-report.spec.ts
acceptance:
  - Renderer invokes diagnostics.exportIssueReport only through src/lib/host-api.ts.
  - Main accepts an empty session-key list and resolves every available selected transcript under its matching agent sessions directory without following an escaping symlink.
  - The ZIP contains every available selected transcript, a recursively redacted OpenClaw config when present, available ClawX and OpenClaw log files with common credential forms redacted, and a manifest that reports stale selections.
  - Archive entry names do not expose source absolute paths.
  - Export writes a uniquely named ZIP atomically to the Desktop directory on macOS and Windows and returns its absolute path.
  - The success state visibly renders the path and can reveal it in the platform file manager.
  - The bug-icon sidebar shortcut sits immediately below Settings, opens the same export workflow without navigating away, remains accessible when the sidebar is collapsed, and Settings retains its existing entry.
  - The dialog shows the bundle contents before export, supports individual and select-all conversation selection, and keeps export enabled with no selected or available conversations.
  - All new UI strings exist in English, Chinese, Japanese, and Russian.
docs:
  required: true
  reason: This changes the user-visible issue-report workflow and diagnostics export payload.
references:
  - harness/specs/scenarios/gateway-backend-communication.md
---

## Scope

- Add issue-report entries in the sidebar and Settings that open one shared dialog previewing bundle contents.
- Allow zero, one, multiple, or all available conversations to be selected.
- Send only selected session keys through the typed Host API; all file access remains in Main.
- Include selected transcripts, sanitized OpenClaw config, available application/runtime logs, and a manifest.
- Show and reveal the resulting ZIP path.

## Out Of Scope

- Uploading or transmitting the archive.
- Editing or deleting source transcripts, configuration, or logs.
- Guaranteeing removal of secrets manually pasted into conversation content or arbitrary log messages.
