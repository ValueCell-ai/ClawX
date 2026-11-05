---
id: development-startup-performance
title: Development Startup Performance
type: development-tooling
ownedPaths:
  - vite.config.ts
  - scripts/vite-dev-watch.ts
  - tests/unit/vite-dev-watch.test.ts
requiredProfiles:
  - fast
requiredRules:
  - development-watch-scope
  - docs-sync
---

Use this scenario for slow Vite/Electron development startup or source watching.
Measure Vite compilation separately from Electron initialization and Gateway
readiness. Generated runtime bundles and packaged applications must not compete
with source compilation through recursive development file watching.

Verify that source files, including source directories named `build`, still emit
change events. Do not use machine-dependent timing thresholds as unit tests.
