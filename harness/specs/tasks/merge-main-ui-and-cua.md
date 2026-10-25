---
id: merge-main-ui-and-cua
title: Merge current main into the refined task UI
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Resolve the in-progress main merge while preserving task navigation and integrating CUA lifecycle recovery and the issue-report shortcut.
touchedAreas:
  - .github/workflows/**
  - electron/**
  - harness/**
  - package.json
  - pnpm-lock.yaml
  - resources/**
  - scripts/**
  - shared/**
  - src/**
  - tests/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Existing brand, global catalog search, local pins and standalone sidebar capability pages remain available.
  - Computer operation retains its developer-mode gate and incorporates the incoming status polling, cancellation guards and explicit retry action.
  - The report shortcut opens the same export workflow as Settings About and help, in expanded and collapsed sidebars.
  - The developer console stays in Advanced settings; no duplicate sidebar entry is restored.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - local-computer-use
  - settings-navigation
  - issue-report-export-safety
  - comms-regression
  - docs-sync
requiredTests:
  - tests/e2e/computer-use.spec.ts
  - tests/e2e/settings-issue-report.spec.ts
  - tests/e2e/settings-navigation.spec.ts
  - tests/e2e/task-sidebar-search-and-pins.spec.ts
  - tests/unit/computer-use-api.test.ts
  - tests/unit/cua-runtime.test.ts
  - tests/unit/i18n-locale-parity.test.ts
acceptance:
  - No conflict markers or unmerged paths remain, and all combined APIs typecheck.
  - Polling cleans up its interval and focus listener on unmount or developer-mode changes without permitting stale snapshots to overwrite explicit operations.
  - Preserve incoming main fixes and the current UI without bypassing Main-owned lifecycle or permissions.
  - Review and reconcile all three READMEs with the actual sidebar and Settings routes.
docs:
  required: true
---

Merge the existing in-progress main revision, retaining both branches' functional
changes. The existing CUA upgrade and issue-report task specs remain authoritative
for their underlying services; this spec covers integration and conflict resolution.
