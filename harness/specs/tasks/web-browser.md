---
id: web-browser
title: Retire the general embedded Web Browser
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve the hardened guest only as an implementation detail of local HTML Preview and remove every general browsing surface.
touchedAreas:
  - harness/specs/tasks/web-browser.md
  - harness/specs/tasks/local-html-and-link-opening.md
  - harness/specs/rules/web-browser-security-and-lifecycle.md
  - harness/reference/web-browser.md
expectedUserBehavior:
  - ClawX has no standalone Web Browser tab, Home surface, address input, browsing history, site-data controls, or custom guest link menu.
  - The retained guest appears only while Preview displays an authorized local HTML file.
  - Every link is inert; users may only choose to preview the HTML file in ClawX or open that file in the system browser.
requiredProfiles:
  - fast
requiredRules:
  - renderer-main-boundary
  - web-browser-security-and-lifecycle
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/local-html-and-link-opening.md
  - pnpm exec vitest run tests/unit/web-browser-host.test.tsx tests/unit/web-browser-policy.test.ts tests/unit/web-browser-session.test.ts tests/unit/web-browser-api.test.ts --maxWorkers=1
acceptance:
  - No renderer route or control can initialize a blank guest or navigate to an HTTP(S) address.
  - The local HTML guest blocks links, navigation, redirects, popups, downloads, network requests, and permissions.
  - Local HTML Preview and system-browser opening remain Main-validated.
docs:
  required: true
---

# General browser retirement

The active implementation task is `local-html-and-link-opening`. This compatibility task records that the former general browser is intentionally removed.
