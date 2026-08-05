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
- when no embedding credentials or user-owned memory-search config exist, preserve `memory_search` through OpenClaw's explicit FTS-only provider instead of disabling the tool
- migrations may replace only the exact legacy ClawX-managed memory-search default, must run at most once, and must preserve later user opt-outs
- tests for config rewrites should assert the final active config, not only intermediate helper output
