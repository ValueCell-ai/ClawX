# Superpowers Plan — CLAWX BR-C: External Gateway Headless Smoke on LAH Fork

**Date:** 2026-07-05
**Author:** Hermes (governed LAH execution)
**Status:** Plan (pre-implementation)

## 1. Mission

Implement and run a governed headless external Gateway smoke for ClawX on the LAH fork,
without Electron and without spawning ClawX Gateway.

## 2. Previous BR Dependencies

| BR | Verdict | Key Artifact |
|---|---|---|
| BR-A | LAH fork readiness | `docs/mcporter/CLAWX_BR_A_LAH_FORK_CONTINUITY.json` |
| BR-B | Isolated env + controlled deps on LAH fork | `docs/mcporter/CLAWX_BR_B_*_CONTINUITY.json` |
| BR-B continuity fix | HEAD corrected | `4dff88c` |

## 3. CodeGraph Status

CodeGraph unavailable in this repo (no `.codegraph/` index). Fell back to grep/file search.
`codegraph_available = false` recorded in continuity JSON.

## 4. Runtime Assessment

- **Node.js:** v22.22.2 — native `WebSocket` global available (`typeof WebSocket === 'function'`).
- **Env flags** (from `clawx-phase1.env`): all 11 safe-mode flags match approval conditions.
- **Existing tests:** Vitest `.ts` tests in `tests/unit/`. But the repo also has `vitest.config.ts` requiring dependencies.
- **Existing `ws` usage:** `gateway-ws-client.test.ts` uses the project's own WebSocket client — importing those would pull in Electron dependencies. Not safe.

## 5. Smoke Script Boundaries

| Aspect | Boundary |
|---|---|
| Target URL | `ws://127.0.0.1:4000/gateway` only (localhost only policy) |
| Env file | `/home/deploy/lah-stack-runtime/clawx-phase1/env/clawx-phase1.env` |
| WebSocket | Use native `WebSocket` global (Node.js 22+), no `ws` package |
| Module type | Node.js ESM (`.mjs`) — no TS compilation needed |
| Spawn | None — the script must never spawn a child process |
| Import Electron | Forbidden — no `require('electron')` or `import ... from 'electron'` |
| Import OpenClaw runtime | Forbidden — no internal Gateway startup code |
| Write to `/home/deploy/.openclaw` | Forbidden |
| Write to production paths | Forbidden |
| Output dir | `/home/deploy/lah-stack-runtime/clawx-phase1/checks/` only |

## 6. No-Spawn/No-Kill/No-Mutation Safety Gates

The script validates these env flags before any action:

```
LAH_SAFE_MODE=1
CLAWX_EXTERNAL_GATEWAY_ENABLED=1
CLAWX_GATEWAY_SPAWN_ENABLED=0
CLAWX_GATEWAY_KILL_ON_CONFLICT=0
CLAWX_OPENCLAW_CONFIG_MUTATION=0
CLAWX_TELEMETRY_ENABLED=0
CLAWX_UPDATE_CHECKS_ENABLED=0
CLAWX_PROVIDER_VALIDATION_ENABLED=0
CLAWX_OAUTH_ENABLED=0
CLAWX_EXTERNAL_URL_OPENING_ENABLED=0
CLAWX_CONNECTIVITY_PROBE_ENABLED=0
```

If ANY flag is misconfigured: exit non-zero, no socket opened.

## 7. Local-Only WebSocket Target Policy

- Only `ws://127.0.0.1:4000/gateway` is accepted.
- Any non-localhost URL → exit non-zero with error.
- Future overrides require explicit addition (not in this BR).

## 8. Dry-Run Behavior

1. Load and parse env file.
2. Validate all 11 flags.
3. Validate target URL is localhost.
4. Validate output directory target exists (or can be created).
5. Validate Node.js `WebSocket` availability.
6. Print what would be tested.
7. Write a dry-run JSON report under `/home/deploy/lah-stack-runtime/clawx-phase1/checks/`.
8. **Do not open any socket.**

## 9. Actual Smoke Behavior

1. Do all dry-run validations first (fail fast if flags fail).
2. Open native `WebSocket` to the local Gateway URL.
3. Wait for the `open` event or timeout (configurable, default 5000ms).
4. Wait for first `message` event (or timeout).
5. Detect `connect.challenge` in the first message payload.
6. Record: target URL, safe-mode flags, connection status, first message content, challenge presence.
7. Close socket cleanly via `websocket.close()`.
8. Write smoke JSON report under checks dir.
9. Exit code 0 on success, non-zero on failure.
10. If Gateway is absent (connection refused/timeout): record `gateway_present=false`, exit 0 (informational).

## 10. Operator Packet

Created at `docs/operator/CLAWX_BR_C_EXTERNAL_GATEWAY_HEADLESS_SMOKE_OPERATOR_PACKET.md`:
- Purpose, dependencies, env reference
- Command examples
- Dry-run vs smoke behavior
- Guarantees (no-spawn, no-kill, no-mutation)
- Expected result fields
- Failure modes
- Rollback plan

## 11. Offline Validation

Static check with `node --check` (no TS compilation needed for `.mjs`).
Repo's Vitest requires `pnpm install` — cannot run without deps.
A standalone `.mjs` test file at `tests/unit/lah-external-gateway-smoke.test.mjs` may be added if practical.

## 12. Merge & Continuity Lock Plan

1. Branch `br-c/external-gateway-headless-smoke`
2. Add scripts + docs
3. Commit
4. Push to fork
5. Merge to fork main (no-ff)
6. Post-merge verify
7. Continuity lock at `docs/mcporter/CLAWX_BR_C_*_CONTINUITY.json`
8. Push continuity lock to fork main

## 13. Risk Assessment

| Risk | Mitigation |
|---|---|
| Gateway not running locally | Record absent, exit 0 |
| WebSocket unavailable | Node 22 has native WS; fallback to record unavailable |
| Script imports something dangerous | Explicit no-import guards in design |
| Env file missing | Explicit error early |
| Flag mismatch | Exit non-zero, don't proceed |
