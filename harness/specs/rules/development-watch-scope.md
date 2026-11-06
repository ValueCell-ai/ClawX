---
id: development-watch-scope
title: Development File Watch Scope
type: ai-coding-rule
appliesTo:
  - development-startup-performance
requiredProfiles:
  - fast
---

Development watchers must exclude the checkout's generated `build`, `release`,
`dist-electron`, `artifacts`, and `playwright-report` trees. Git ignore rules do
not configure Vite's watcher. Scope exclusions to the checkout root so a source
directory with the same name remains watchable, and preserve source and extension
hot reload. Keep platform security settings and runtime data untouched.

Use separate processes when comparing first-build costs: Vite/esbuild caches in
one process can hide the initial watcher contention. Record measured build times
as local evidence rather than universal performance promises.
