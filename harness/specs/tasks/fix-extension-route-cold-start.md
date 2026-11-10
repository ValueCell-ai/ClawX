---
id: fix-extension-route-cold-start
title: Render extension routes after cold startup registration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep the root route tree synchronized with renderer extension registration so direct extension URLs and reloads render without unrelated navigation or store changes.
touchedAreas:
  - src/App.tsx
  - src/extensions/registry.ts
  - tests/unit/app-extension-routes.test.tsx
  - tests/e2e/extension-routes.spec.ts
  - tests/e2e/fixtures/renderer-extension.tsx
  - harness/specs/tasks/fix-extension-route-cold-start.md
  - harness/specs/rules/renderer-main-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
expectedUserBehavior:
  - Opening or reloading an installed extension page displays its page and application navigation immediately after registration.
  - A slow asynchronous extension setup does not hide its already registered routes.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - e2e-parallel-isolation
requiredTests:
  - tests/unit/app-extension-routes.test.tsx
  - tests/e2e/extension-routes.spec.ts
acceptance:
  - Root routing observes registry registration and teardown without relying on settings, Gateway updates, or navigation to cause a render.
  - React StrictMode teardown and reinitialization preserve exactly one registered extension and render the direct route.
  - Electron coverage uses a synthetic extension, isolated profile and renderer build, and verifies direct entry and reload while settings initialization remains pending.
  - No real enterprise credentials, endpoints, installed applications, or existing profiles are required by the regression.
docs:
  required: false
---

The root component previously read routes during render and registered extensions
in a later effect. Because registration was not observable, a direct extension
URL could remain blank until an unrelated root render occurred. The registry is
an external store: publish a stable revision and subscribe from root routing.
Registration remains synchronous and asynchronous setup keeps its existing lifecycle.

README.md, README.zh-CN.md and README.ja-JP.md were reviewed. This restores existing
extension navigation and introduces no new user flow or configuration to document.

Validation on Windows passed both focused App tests, the isolated Electron direct
entry/reload case, web typecheck, targeted ESLint, the production Vite build,
communication replay/compare, and the 22 harness baseline tests. Removing only
the root registry subscription with a test-time transform reproduced the blank
route with only the Toaster, while the built-in route remained available.

The Electron test output must use a dedicated directory outside shared task
artifacts via Playwright's `--output`; its renderer and profile are created by the
existing per-test temporary-home fixture. Harness checks on this CRLF Windows
checkout used process-local line-ending normalization, and communication scripts
used process-local file-URL conversion; repository tooling was not modified.
