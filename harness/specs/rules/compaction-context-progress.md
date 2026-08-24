---
id: compaction-context-progress
title: Compaction context progress
appliesTo:
  - patches/openclaw@*.patch
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-compaction*.test.ts
requiredTests:
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/openclaw-auth.test.ts
---

# Compaction Context Progress

When ClawX configures `keepRecentTokens: 0`, OpenClaw must summarize every
completed pre-compaction turn and harden the persisted boundary to the new
compaction entry. It must not replay a completed message merely because that
message crosses a token-retention threshold.

`recentTurnsPreserve: 0` must omit the deterministic verbatim suffix from the
summary. The active turn remains outside completed history and is not silently
dropped or rewritten by this policy.

Do not harden a boundary unless the removed completed messages were included in
the summary input. A checkpoint may record the hardened boundary, but deleting
checkpoint metadata alone does not change reconstructed model context.
