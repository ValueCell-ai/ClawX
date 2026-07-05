# BR-C Operator Packet: ClawX External Gateway Headless Smoke (LAH Fork)

**Packet ID:** `CLAWX_BR_C_EXTERNAL_GATEWAY_HEADLESS_SMOKE_OPERATOR_PACKET`
**Date:** 2026-07-05
**Author:** Hermes (governed LAH execution)
**Status:** OPERATIONAL — Smoke complete

---

## 1. Purpose

Prove that the BR-A external Gateway safe-mode wiring and BR-B isolated environment can be used to perform a headless WebSocket connection to the existing LAH OpenClaw Gateway at `ws://127.0.0.1:4000/gateway`, without Electron and without spawning ClawX Gateway.

## 2. Previous BR Dependencies

| BR | Verdict | Artifact |
|---|---|---|
| BR-A | LAH fork readiness | `docs/mcporter/CLAWX_BR_A_LAH_FORK_CONTINUITY.json` |
| BR-B | Isolated env + controlled deps on LAH fork | `docs/mcporter/CLAWX_BR_B_ISOLATED_ENV_AND_CONTROLLED_DEPS_CONTINUITY.json` |
| BR-B continuity fix | HEAD corrected | `4dff88c` (continuity correction commit) |

## 3. Required Safe-Mode Env Flags

All flags loaded from: `/home/deploy/lah-stack-runtime/clawx-phase1/env/clawx-phase1.env`

| Flag | Value | Purpose |
|---|---|---|
| `LAH_SAFE_MODE` | `1` | Master safe-mode switch |
| `CLAWX_EXTERNAL_GATEWAY_ENABLED` | `1` | Enable external Gateway mode |
| `CLAWX_GATEWAY_SPAWN_ENABLED` | `0` | Prevent Gateway spawn |
| `CLAWX_GATEWAY_KILL_ON_CONFLICT` | `0` | Prevent Gateway kill |
| `CLAWX_OPENCLAW_CONFIG_MUTATION` | `0` | Prevent OpenClaw config writes |
| `CLAWX_TELEMETRY_ENABLED` | `0` | Disable telemetry |
| `CLAWX_UPDATE_CHECKS_ENABLED` | `0` | Disable update checks |
| `CLAWX_PROVIDER_VALIDATION_ENABLED` | `0` | Disable provider validation |
| `CLAWX_OAUTH_ENABLED` | `0` | Disable OAuth |
| `CLAWX_EXTERNAL_URL_OPENING_ENABLED` | `0` | Disable external URL opening |
| `CLAWX_CONNECTIVITY_PROBE_ENABLED` | `0` | Disable connectivity probes |

All flags **validated** before any socket action.

## 4. Commands

### Dry-run (no socket)
```bash
node scripts/lah/clawx-external-gateway-headless-smoke.mjs --dry-run
```

### Actual smoke
```bash
node scripts/lah/clawx-external-gateway-headless-smoke.mjs --smoke
```

### Custom paths
```bash
node scripts/lah/clawx-external-gateway-headless-smoke.mjs \
  --env /path/to/env/file \
  --out /path/to/checks/dir \
  --timeout-ms 5000
```

## 5. Dry-Run Behavior

1. Load and parse env file.
2. Validate all 11 safe-mode flags.
3. Validate target URL is localhost only.
4. Validate output directory exists/writable.
5. Validate Node.js WebSocket availability.
6. Print what would be tested.
7. Write a JSON report to checks/ dir.
8. **No socket is opened.**

## 6. Smoke Behavior

1. All dry-run validations (fail fast if flags fail).
2. Open native `WebSocket` to `ws://127.0.0.1:4000/gateway`.
3. Wait for `open` event or timeout.
4. Wait for first `message` event or timeout.
5. Detect `connect.challenge` in first message.
6. Record: target URL, flags, connection status, first message, challenge.
7. Close socket cleanly.
8. Write JSON report to checks/ dir.

## 7. No-Spawn / No-Kill / No-Mutation Guarantees

| Guarantee | Enforcement |
|---|---|
| No process spawn | Script never calls `child_process` or `spawn`/`exec` |
| No Gateway spawn | `CLAWX_GATEWAY_SPAWN_ENABLED=0` — validated as invariant |
| No Gateway kill | `CLAWX_GATEWAY_KILL_ON_CONFLICT=0` — validated as invariant |
| No OpenClaw config mutation | `CLAWX_OPENCLAW_CONFIG_MUTATION=0` — validated as invariant |
| No Electron import | No `require('electron')` or `import ... from 'electron'` |
| No OpenClaw runtime import | No internal Gateway startup code imported |
| No write to `~/.openclaw` | Only writes to isolated runtime checks/ dir |
| No dependency install | Uses only Node.js native APIs (fs, path, os) and global `WebSocket` |
| No network external | Only connects to `ws://127.0.0.1:4000/gateway` |

## 8. Expected Result Fields

| Field | Description |
|---|---|
| `target_url` | Gateway WebSocket URL used |
| `connection_opened` | Whether WebSocket `open` event fired |
| `first_message_received` | Whether any message was received |
| `first_message_text` | First message content (truncated to 500 chars) |
| `challenge_observed` | Whether `connect.challenge` was detected |
| `challenge_type` | Type of challenge/protocol detected |
| `error` | Error message if any |
| `gateway_present` | Whether Gateway was reachable |
| `flags_passed` | Whether all safe-mode flags are valid |
| `websocket_runtime_available` | Whether `globalThis.WebSocket` exists |

## 9. Failure Modes

| Failure | Behavior | Exit Code |
|---|---|---|
| Env file missing | Die with error | 1 |
| Non-localhost target | Die with error | 1 |
| Flag validation fails (smoke) | Die, don't open socket | 1 |
| Flag validation fails (dry-run) | Continue, print warning | 1 |
| WebSocket timeout | Record absent, exit 0 | 0 |
| WebSocket error/refused | Record absent, exit 0 | 0 |

## 10. Rollback Plan

Revert BR-C:
```bash
git revert --no-edit <BR-C-MERGE-COMMIT>
git push fork main
```
Remove smoke report from checks dir:
```bash
rm -f /home/deploy/lah-stack-runtime/clawx-phase1/checks/clawx-gateway-headless-smoke-*.json
```
Remove continuity lock and operator packet:
```bash
git rm docs/mcporter/CLAWX_BR_C_EXTERNAL_GATEWAY_HEADLESS_SMOKE_CONTINUITY.json
git rm docs/operator/CLAWX_BR_C_EXTERNAL_GATEWAY_HEADLESS_SMOKE_OPERATOR_PACKET.md
git commit -m "docs: revert BR-C operator packet and continuity lock"
git push fork main
```

## 11. Next BR Recommendation

`CLAWX_BR_D_ELECTRON_ISOLATED_SMOKE_ON_LAH_FORK`