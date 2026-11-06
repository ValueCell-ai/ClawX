---
id: fix-windows-dev-startup-watch-scope
title: Exclude generated runtime trees from development file watching
scenario: development-startup-performance
taskType: development-tooling
intent: Remove measured Windows Vite build contention from watching generated runtime bundles while preserving source hot reload.
touchedAreas:
  - vite.config.ts
  - scripts/vite-dev-watch.ts
  - tests/unit/vite-dev-watch.test.ts
  - harness/specs/scenarios/development-startup-performance.md
  - harness/specs/rules/development-watch-scope.md
  - harness/specs/tasks/fix-windows-dev-startup-watch-scope.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - pnpm dev compiles Electron without recursively watching generated runtime and packaging directories.
  - Editing source files still triggers development change events, including source directories named build.
  - The existing enterprise extension integration and CDP environment variable remain usable.
requiredProfiles:
  - fast
requiredRules:
  - development-watch-scope
  - docs-sync
requiredTests:
  - tests/unit/vite-dev-watch.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
acceptance:
  - Generated directory exclusions are rooted at the checkout and handle Windows path separators.
  - An actual Vite watcher ignores generated files and observes source edits.
  - A repeated pnpm dev start records Main and preload compilation durations and still exposes the ClawX page on CDP port 9223 when requested.
docs:
  required: true
---

Local Windows baseline: Main build 176941 ms and preload build 52335 ms.
An isolated preload build with the default root watcher took 27181 ms in a
fresh process; excluding generated artifacts took 764 ms in a fresh process.
Evidence lives under ignored `artifacts/review/windows-dev-startup/`.
This task changes development watching only; Gateway migration and readiness
policies are outside its scope.
