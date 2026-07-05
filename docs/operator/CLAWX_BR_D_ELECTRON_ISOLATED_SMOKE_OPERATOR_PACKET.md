# BR-D Operator Packet: ClawX Electron Isolated Smoke (LAH Fork)

**Packet ID:** `CLAWX_BR_D_ELECTRON_ISOLATED_SMOKE_OPERATOR_PACKET`
**Date:** 2026-07-05
**Author:** Hermes (governed LAH execution)
**Status:** OPERATIONAL — Harness ready, Electron runtime unavailable

---

## 1. Purpose

Implement an isolated Electron smoke harness for ClawX on the LAH fork,
proving that the BR-B isolated runtime environment is ready for Electron
without touching production state, without spawning/killing Gateway, and
using external Gateway mode only.

## 2. Previous BR Dependencies

| BR | Verdict | Artifact |
|---|---|---|
| BR-A | LAH fork readiness | `docs/mcporter/CLAWX_BR_A_LAH_FORK_CONTINUITY.json` |
| BR-B | Isolated env + controlled deps | `docs/mcporter/CLAWX_BR_B_ISOLATED_ENV_AND_CONTROLLED_DEPS_CONTINUITY.json` |
| BR-C | External Gateway headless smoke | Gateway present, connect.challenge observed |

## 3. Approval Phrase

```
APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE
```

Pass with `--approval "APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE"`

This mission context does **not** contain the approval phrase.
Actual Electron launch requires explicit operator approval.

## 4. Required Safe-Mode Env Flags

All flags loaded from: `/home/deploy/lah-stack-runtime/clawx-phase1/env/clawx-phase1.env`

| Flag | Value | Purpose |
|---|---|---|
| `LAH_SAFE_MODE` | `1` | Master safe-mode switch |
| `HOME` | `/home/deploy/lah-stack-runtime/clawx-phase1/home` | Isolated home |
| `CLAWX_USER_DATA_DIR` | `/home/deploy/lah-stack-runtime/clawx-phase1/userData` | Isolated user data |
| `CLAWX_EXTERNAL_GATEWAY_URL` | `ws://127.0.0.1:4000/gateway` | External Gateway URL |
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

## 5. Commands

### Dry-run (no Electron launch)
```bash
node scripts/lah/clawx-electron-isolated-smoke.mjs --dry-run
```

### Smoke (requires approval)
```bash
node scripts/lah/clawx-electron-isolated-smoke.mjs --smoke --approval "APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE"
```

### Custom paths
```bash
node scripts/lah/clawx-electron-isolated-smoke.mjs \
  --env /path/to/env/file \
  --out /path/to/checks/dir \
  --timeout-ms 15000
```

## 6. Dry-Run Behavior

1. Load and parse env file.
2. Validate all 12 safety flags (including HOME and CLAWX_USER_DATA_DIR).
3. Validate Gateway URL is localhost only.
4. Validate isolated paths are under `clawx-phase1/`.
5. Detect Electron binary availability without installing.
6. Identify candidate launch command without running it.
7. Write JSON report to checks/ dir.
8. No Electron launched — no socket opened.

## 7. Smoke Behavior

1. All dry-run validations (fail fast if flags fail).
2. Require approval phrase `--approval "...APPROVE..."`.
3. If Electron unavailable: record `electron_runtime_available=false`, exit 0.
4. If Electron available: launch with explicit isolated env variables.
5. Observe for bounded timeout (default 15s).
6. Terminate only launched child process.
7. Write JSON report to checks/ dir.
8. Never spawn/kill Gateway — enforced by isolated env flags.

## 8. No-Spawn / No-Kill / No-Mutation Guarantees

| Guarantee | Enforcement |
|---|---|
| No dependency install | Script never calls pnpm/npm; detects missing deps gracefully |
| No Gateway spawn | `CLAWX_GATEWAY_SPAWN_ENABLED=0` — validated as env flag |
| No Gateway kill | `CLAWX_GATEWAY_KILL_ON_CONFLICT=0` — validated as env flag |
| No OpenClaw config mutation | `CLAWX_OPENCLAW_CONFIG_MUTATION=0` — validated as env flag |
| No external URL opening | `CLAWX_EXTERNAL_URL_OPENING_ENABLED=0` — validated as env flag |
| No OAuth | `CLAWX_OAUTH_ENABLED=0` — validated as env flag |
| No production write | Only writes to isolated runtime checks/ dir |
| Only kill launched child | Script kills only its own spawned process, never global processes |

## 9. Expected Result Fields

| Field | Description |
|---|---|
| `target_url` | Gateway WebSocket URL |
| `flags_passed` | All safe-mode flags valid |
| `paths_passed` | HOME and CLAWX_USER_DATA_DIR under isolated root |
| `electron.available` | Whether Electron binary found locally |
| `launch_command.source` | Where the launch binary was sourced from |
| `result.process_started` | Whether Electron process was spawned |
| `result.exit_code` | Process exit code |
| `result.exit_signal` | Process exit signal |
| `result.timed_out` | Whether timeout was reached |
| `result.gateway_spawn_attempted` | Must be false |
| `result.gateway_kill_attempted` | Must be false |
| `result.production_openclaw_touched` | Must be false |

## 10. Failure Modes

| Failure | Behavior |
|---|---|
| Env file missing | Die with error |
| Non-localhost target | Die with error |
| Flag validation fails (smoke) | Die, don't launch |
| Path validation fails (smoke) | Die, don't launch |
| Approval phrase missing (smoke) | Die if Electron available; else report unavailable |
| Electron unavailable | Record, exit 0 |

## 11. Rollback Plan

Revert BR-D:
```bash
git revert --no-edit <BR-D-MERGE-COMMIT>
git push fork main
```
Remove smoke report from checks dir, remove continuity lock and operator packet:
```bash
rm -f /home/deploy/lah-stack-runtime/clawx-phase1/checks/clawx-electron-isolated-smoke-*.json
git rm docs/mcporter/CLAWX_BR_D_ELECTRON_ISOLATED_SMOKE_CONTINUITY.json
git rm docs/operator/CLAWX_BR_D_ELECTRON_ISOLATED_SMOKE_OPERATOR_PACKET.md
git commit -m "docs: revert BR-D operator packet and continuity lock"
git push fork main
```

## 12. Next BR Recommendation

`CLAWX_BR_E_CONTROLLED_DEPENDENCY_INSTALL_OR_APP_SESSION_SMOKE_ON_LAH_FORK`