---
id: enable-fts-memory-search-default
title: Enable keyword-only memory search when embeddings are unavailable
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep OpenClaw memory_search usable without an OpenAI embedding key by selecting its explicit FTS-only provider.
touchedAreas:
  - electron/utils/openclaw-memory-search.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/store.ts
  - tests/unit/openclaw-memory-search.test.ts
  - tests/unit/openclaw-auth.test.ts
  - harness/specs/rules/active-config-guards.md
  - harness/specs/tasks/enable-fts-memory-search-default.md
expectedUserBehavior:
  - A user without memory-search configuration or an OpenAI embedding key gets keyword-only memory search instead of a disabled memory_search tool.
  - A user with an OpenAI embedding key and no memory-search configuration retains OpenClaw's default embedding-backed behavior.
  - Existing global or per-agent memory-search configuration remains user-owned.
  - The exact legacy ClawX-managed disabled default is migrated to FTS-only once, after which an explicit user opt-out remains respected.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-memory-search.test.ts
  - tests/unit/openclaw-auth.test.ts
acceptance:
  - ClawX seeds agents.defaults.memorySearch with enabled true and provider none only when no memory-search configuration and no OpenAI embedding key exist.
  - The exact legacy agents.defaults.memorySearch shape with only enabled false migrates to the FTS-only default at most once.
  - Any memory-search object with additional fields and all per-agent overrides remain unchanged.
  - The migration marker is persisted outside openclaw.json so OpenClaw schema validation is unaffected.
  - Targeted unit tests, type checks, communication regression checks, and harness validation pass.
docs:
  required: false
---

OpenClaw 2026.7.1 supports deliberate keyword-only recall through
`agents.defaults.memorySearch.provider: "none"`. Use that mode as ClawX's
safe no-key default instead of disabling memory search.
