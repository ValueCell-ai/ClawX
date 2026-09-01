---
id: e2e-parallel-isolation
title: E2E Parallel Isolation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - e2e
---

Electron E2E tests are parallel by default because each test owns its HOME, OpenClaw state directory, Electron user-data directory, and Host API configuration. Keep those fixtures test-scoped.

Tests that mutate OS-global state must use `E2E_EXCLUSIVE_TAG`. Tests that profile shared host CPU, GPU, display, or frame pacing must use `E2E_PERFORMANCE_TAG`. Do not use Playwright serial mode as a cross-file mutex; serial mode only orders tests within its own group.

When adding another global resource, extend the automated policy check where the resource has a recognizable API. Unknown external resources still require reviewer classification.

The project graph, environment isolation, and validation commands are documented in `harness/reference/e2e-parallelism.md`.
