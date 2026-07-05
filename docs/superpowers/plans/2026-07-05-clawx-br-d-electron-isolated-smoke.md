# Superpowers Plan — CLAWX BR-D: Electron Isolated Smoke on LAH Fork

**Date:** 2026-07-05
**Author:** Hermes (governed LAH execution)
**Status:** Plan (pre-implementation)

## 1. Mission

Implement an isolated Electron smoke harness for ClawX on the LAH fork,
proving that the BR-B isolated environment is ready for Electron without
touching production state, without spawning/killing Gateway, and using external
Gateway mode only.

## 2. Previous BR Dependencies

| BR | Verdict | Artifact |
|---|---|---|
| BR-A | LAH fork readiness | `docs/mcporter/CLAWX_BR_A_LAH_FORK_CONTINUITY.json` |
| BR-B | Isolated env + controlled deps | `docs/mcporter/CLAWX_BR_B_*_CONTINUITY.json` |
| BR-C | Headless Gateway smoke | Gateway present, challenge observed |

## 3. CodeGraph Status

CodeGraph unavailable (no `.codegraph/` index). Fell back to grep/sub-agent analysis.

## 4. Runtime Assessment

| Aspect | Status |
|---|---|
| Electron binary | **Unavailable** — no `node_modules/` (deps not installed) |
| Built entry (`dist-electron/main/index.js`) | **Does not exist** |
| System libs (`libnspr4.so`) | **Missing** |
| pnpm install | Forbidden by BR-D scope |
| npm install | Forbidden |
| postinstall script | Would trigger `node scripts/patch-browser-hint.mjs` if installed |
| npx electron --version | Downloads binary but fails (missing libs) |

**Conclusion:** `electron_runtime_available = false`. Smoke script will detect this and report it.

## 5. Smoke Script Boundaries

| Aspect | Boundary |
|---|---|
| Target URL | `ws://127.0.0.1:4000/gateway` only |
| Env file | `/home/deploy/lah-stack-runtime/clawx-phase1/env/clawx-phase1.env` |
| Output dir | `/home/deploy/lah-stack-runtime/clawx-phase1/checks` |
| Launch | Only if Electron binary found + approval phrase present |
| Import | No `require('electron')` — only `child_process.spawn` for launching |
| Gateway spawn | Never — validated by env flags |
| Gateway kill | Never — validated by env flags |
| Config mutation | Never — validated by env flags |
| Write to ~/.openclaw | Forbidden — only writes to checks dir |
| Approval phrase | `"APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE"` |

## 6. Approval Gate

The script requires `--approval "APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE"` for smoke mode.
Without it, dry-run only.

This mission context does **not** contain the approval phrase. So smoke will not run.

## 7. No-Spawn/No-Kill/No-Mutation Safety Gates

12 env flags validated before any action (mirrors BR-C plus HOME and CLAWX_USER_DATA_DIR).

## 8. Dry-Run Behavior

1. Load and parse env file
2. Validate all 12 flags (including HOME and CLAWX_USER_DATA_DIR)
3. Validate Gateway URL local-only
4. Validate output directory writable
5. Detect Electron binary availability without installing
6. Identify candidate launch command without running it
7. Print what would be tested
8. Write dry-run JSON report to checks dir
9. Do not launch Electron

## 9. Smoke Behavior

1. All dry-run validations (fail fast if flags fail)
2. Require approval phrase `--approval "APPROVE CLAWX BR-D ELECTRON ISOLATED SMOKE"`
3. If Electron unavailable: record and exit with script-ready/runtime-unavailable
4. If Electron available: launch with isolated env, observe timeout, terminate child
5. No Gateway spawn/kill attempted
6. Write smoke JSON report

## 10. Electron Launch Strategy (if available)

- Determine Electron binary: `node_modules/.bin/electron` or npx
- Set all env flags explicitly via `spawn` options
- Set isolated HOME and CLAWX_USER_DATA_DIR
- Timeout and kill only spawned child
- Collect stdout/stderr

## 11. Operator Packet

At `docs/operator/CLAWX_BR_D_ELECTRON_ISOLATED_SMOKE_OPERATOR_PACKET.md`

## 12. Offline Validation

- `node --check` syntax verification
- Dry-run execution
- vitest depends on `pnpm install` — skipped

## 13. Merge & Continuity Lock Plan

Same as BR-C: branch, commit, push, merge, continuity lock.

## 14. Risk Assessment

| Risk | Mitigation |
|---|---|
| Electron unavailable | Detect, record, don't launch |
| Approval absent | Dry-run only, document as script-ready |
| Script spawns more than Electron | Only one fully-scoped spawn call |
| System libs missing | Already known — recorded |