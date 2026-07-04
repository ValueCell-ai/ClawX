# CLAWX Phase 1 Isolated External Gateway Operator Packet

## Purpose
Prepare ClawX for a future isolated Phase 1 run that attaches to an existing LAH Gateway instead of spawning or mutating a production OpenClaw runtime.

## What Changed
- Added explicit external Gateway mode.
- Added LAH safe-mode runtime gates for telemetry, update checks, OAuth, provider validation, external URL opening, and connectivity probes.
- Added isolated userData and HOME-aware path resolution.
- Added offline tests for the new runtime gates and safety boundaries.

## Exact Env Vars
Use these for future isolated Phase 1 runs:

```bash
export LAH_SAFE_MODE=1
export HOME=/home/deploy/lah-stack-runtime/clawx-phase1/home
export CLAWX_USER_DATA_DIR=/home/deploy/lah-stack-runtime/clawx-phase1/userData
export CLAWX_EXTERNAL_GATEWAY_URL=ws://127.0.0.1:4000/gateway
export CLAWX_GATEWAY_SPAWN_ENABLED=0
export CLAWX_GATEWAY_KILL_ON_CONFLICT=0
export CLAWX_OPENCLAW_CONFIG_MUTATION=0
export CLAWX_TELEMETRY_ENABLED=0
export CLAWX_UPDATE_CHECKS_ENABLED=0
export CLAWX_PROVIDER_VALIDATION_ENABLED=0
export CLAWX_OAUTH_ENABLED=0
export CLAWX_EXTERNAL_URL_OPENING_ENABLED=0
export CLAWX_CONNECTIVITY_PROBE_ENABLED=0
```

## Exact Isolated Paths
- `/home/deploy/lah-stack-runtime/clawx-phase1/home`
- `/home/deploy/lah-stack-runtime/clawx-phase1/userData`
- `/home/deploy/lah-stack-runtime/clawx-phase1/logs`
- `/home/deploy/lah-stack-runtime/clawx-phase1/home/.openclaw`

## Forbidden Production Paths
- `/home/deploy/.openclaw`
- `/home/deploy/.hermes`
- any production provider secret store
- any production ClawX or OpenClaw runtime directory

## Allowed Future Commands
- `git status`
- `git diff`
- offline unit tests
- static type checks that do not install dependencies
- isolated-path smoke checks that do not launch Electron, Gateway, or OpenClaw

## Forbidden Commands
- `pnpm install`
- `npm install`
- `pnpm run init`
- Electron launch
- OpenClaw launch
- Gateway launch
- any network-dependent check
- any provider-secret import or migration
- any command that writes to production `~/.openclaw`

## Rollback Plan
- Remove only the isolated runtime directory tree if it was created for testing.
- Do not delete production `~/.openclaw`.
- Do not delete production credentials.
- Do not delete production agents.
- Do not delete production skills or extensions unless they were explicitly created inside the isolated ClawX env.
- Revert the branch with git if the patch must be removed.

## Tests Run
- Offline unit tests only.
- No runtime launches.
- No provider or network checks.

## Tests Not Run and Why
- Electron launch: forbidden by mission scope.
- Gateway launch: forbidden by mission scope.
- OpenClaw launch: forbidden by mission scope.
- Install scripts: forbidden by mission scope.
- Network checks: forbidden by mission scope.

## Residual Risks
- External Gateway support is still a pre-Phase 1 bridge, not a full production isolation boundary.
- OpenClaw secret storage remains a migration risk until keychain-backed storage exists.
- Install-chain verification is still pending checksum/signature hardening.

## Next BR Recommendation
- Hardening BR for install-chain verification and deterministic offline artifact handling.
- Secret-storage BR for keychain-backed provider secrets.
- Follow-up BR for any remaining direct OpenClaw runtime coupling discovered during Phase 1.
