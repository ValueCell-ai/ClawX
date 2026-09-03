---
id: compaction-context-progress
title: Compaction context progress
appliesTo:
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-compaction*.test.ts
requiredTests:
  - tests/unit/openclaw-auth.test.ts
---

# Compaction Context Progress

OpenClaw 2026.8.1 owns compaction pressure, recovery, boundary hardening, and
tool-result truncation. ClawX must use only the supported configuration
contract and must not carry content-hashed runtime patches for behavior already
fixed upstream.

ClawX configures `keepRecentTokens: 1`, the smallest schema-valid positive
budget, together with `recentTurnsPreserve: 0`. This preserves an effectively
empty retained tail and omits the deterministic verbatim suffix without
depending on the retired zero-token patch.

The active turn remains outside completed history. `identifierPolicy` may be
`strict` or an explicit user-owned `off`; retired `identifierInstructions` and
`reserveTokensFloor` keys must be removed before final config validation.
