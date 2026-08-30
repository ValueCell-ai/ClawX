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

Mid-turn prompt-pressure estimation may inspect a larger live tool-result view
than the already-capped persisted transcript. When persisted recovery reports
exactly `no oversized or aggregate tool results`, continue from that transcript
without manufacturing a context overflow or compaction. Refund the run retry
only when a non-error tool result proves that the active turn made progress;
empty sessions and truncation errors keep the normal compaction fallback.

When measured prompt overflow is caused by aggregate tool-result pressure, use
the overflow deficit and the existing route buffer to derive one aggregate
character target. Mid-turn, pre-prompt, no-real-conversation, and
post-compaction recovery must reuse that target, prefer older tool results, and
retain a bounded representation of protected trailing results without breaking
tool-call/result pairing. A `no real conversation messages` result cannot reset
token state while transcript or rendered-prompt pressure still proves a real
overflow; stale-counter reset remains only for pressure that is not so proven.

Do not harden a boundary unless the removed completed messages were included in
the summary input. A checkpoint may record the hardened boundary, but deleting
checkpoint metadata alone does not change reconstructed model context.
