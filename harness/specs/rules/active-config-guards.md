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
- when compaction config is absent, seed safeguard mode with `midTurnPrecheck.enabled = true`; OpenClaw 2026.10 owns the compaction reserve, so ClawX must not write `reserveTokensFloor` or `identifierInstructions` and must map a legacy `identifierPolicy: "custom"` to `"strict"`; explicit mid-turn precheck choices remain user-owned
- launch-time writers must emit the OpenClaw 2026.10 config shape: `tools.exec.mode`, `skills.workshop.autonomous.mode`, `session.reset`, root `memory.search`, `agents.defaults.mediaModels.image`, and a keyed `agents.entries` roster with `agents.ownership: "explicit"` plus `agents.defaults.systemAgent.agentId` whenever more than one agent exists; readers must still accept the legacy 2026.7.1 shapes until doctor migrates them
- config written by ClawX must pass `openclaw config validate` for the bundled OpenClaw version; user-owned legacy keys that ClawX does not manage are left for the startup `doctor --fix` repair to migrate
- tests for config rewrites should assert the final active config, not only intermediate helper output
