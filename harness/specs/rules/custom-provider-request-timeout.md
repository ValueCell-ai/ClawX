---
id: custom-provider-request-timeout
title: Custom Provider Request Timeout
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/openclaw-auth.test.ts
---

ClawX-owned OpenAI-compatible provider entries whose runtime key starts with `custom-` must have a bounded provider-level model request timeout. When `timeoutSeconds` is absent, ClawX writes `45`; an explicit finite non-negative value, including zero, is user-owned and must remain unchanged.

The missing-only default applies both to `models.providers.custom-*` in `openclaw.json` and to custom-provider entries that ClawX maintains in each Agent's `models.json`. Startup synchronization repairs existing global custom-provider entries so upgrading users do not need to re-save credentials. Built-in providers, local providers, the separate `clawx-openai-image` provider, and all other non-`custom-` entries must not receive this default.

The 45-second timeout is a per-attempt transport bound. It is intentionally below the 180-second Gateway liveness deadline so the OpenAI-compatible client's default retry budget can settle a silent provider request before ClawX needs to recover the entire owned Gateway. Do not weaken or workload-gate the independent Gateway heartbeat and core-RPC verification policy.
