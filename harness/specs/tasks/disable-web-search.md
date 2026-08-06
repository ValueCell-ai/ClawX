---
id: disable-web-search
title: Disable general-purpose web search in ClawX
taskType: runtime-bridge
intent: Prevent ClawX agents from using OpenClaw's general-purpose web_search tool while retaining explicit browser automation and URL fetching.
scenario: gateway-backend-communication
touchedAreas:
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/sanitize-config.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/disable-web-search.md
expectedUserBehavior:
  - ClawX agents cannot invoke the web_search tool.
  - Gateway-exposed tools cannot bypass the agent-level web_search restriction.
  - Existing user-defined tool deny entries remain intact.
  - Managed browser automation and web_fetch remain available.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/sanitize-config.test.ts
acceptance:
  - Config sanitization adds web_search to tools.deny and gateway.tools.deny.
  - Repeated sanitization is idempotent and does not duplicate deny entries.
  - Existing deny entries are preserved in their original order.
  - No browser or web_fetch deny entry is introduced.
  - Targeted unit tests, type checks, communication regression checks, and harness validation pass.
docs:
  required: true
---

ClawX uses managed browser automation and explicit URL fetching when internet access is needed. General-purpose OpenClaw web search is disabled at both policy layers so agent and Gateway tool surfaces remain consistent.
