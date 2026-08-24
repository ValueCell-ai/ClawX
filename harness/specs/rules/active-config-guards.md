---
id: active-config-guards
title: Active Config Guards
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - plugin-lifecycle-management
---

Final OpenClaw runtime config must represent the resolved and validated plugin state, not raw discovery state.

Rules:

- unresolved or conflicted capabilities must not be written as active runtime owners
- allowlists and entries must agree about which package owns a single-owner capability
- disabling a bundled plugin is required when removing it from an allowlist is not sufficient to stop runtime loading
- stale plugin registrations for unconfigured capabilities must be removed during sanitize or recovery paths
- ClawX must include `web_search` in both `tools.deny` and `gateway.tools.deny`; existing deny entries remain user-owned and browser automation plus `web_fetch` remain available
- ClawX must include `gateway`, `nodes`, `create_goal`, `get_goal`, and `update_goal` in both deny lists without blocking application-owned Gateway RPCs; it must not implicitly deny messaging, session orchestration, or agent discovery tools
- when no embedding credentials or user-owned memory-search config exist, preserve `memory_search` through OpenClaw's explicit FTS-only provider instead of disabling the tool
- migrations may replace only the exact legacy ClawX-managed memory-search default, must run at most once, and must preserve later user opt-outs
- when compaction config is absent, seed safeguard mode with `reserveTokensFloor = 50000` and `midTurnPrecheck.enabled = true`; upgrades may backfill missing compaction safety fields but must preserve every explicit reserve floor and explicit mid-turn precheck choice
- tests for config rewrites should assert the final active config, not only intermediate helper output
