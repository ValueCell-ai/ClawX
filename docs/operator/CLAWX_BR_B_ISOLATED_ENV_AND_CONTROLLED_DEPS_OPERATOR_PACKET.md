# CLAWX BR-B Isolated Env And Controlled Deps Operator Packet

## Purpose
Prepare the isolated Phase 1 environment and document the controlled dependency boundary for ClawX on the LAH fork. This is a preflight-only BR.

## Previous BR-A Dependency
BR-B depends on the BR-A safe-mode patch already merged on the LAH fork:

- `8557a68` feat: add external gateway safe mode for LAH
- `f264df0` fix: address safe mode review findings
- `6217fa7` fix: guard OpenClaw config writers in safe mode

## Isolated Paths
Use only this isolated runtime root:

- `/home/deploy/lah-stack-runtime/clawx-phase1`

Required layout:

- `/home/deploy/lah-stack-runtime/clawx-phase1/home`
- `/home/deploy/lah-stack-runtime/clawx-phase1/home/.openclaw`
- `/home/deploy/lah-stack-runtime/clawx-phase1/userData`
- `/home/deploy/lah-stack-runtime/clawx-phase1/logs`
- `/home/deploy/lah-stack-runtime/clawx-phase1/env`
- `/home/deploy/lah-stack-runtime/clawx-phase1/artifacts`
- `/home/deploy/lah-stack-runtime/clawx-phase1/checks`

## Exact Env Vars
Use these exports for isolated Phase 1 prep:

```bash
export LAH_SAFE_MODE=1
export HOME=/home/deploy/lah-stack-runtime/clawx-phase1/home
export CLAWX_USER_DATA_DIR=/home/deploy/lah-stack-runtime/clawx-phase1/userData
export CLAWX_EXTERNAL_GATEWAY_URL=ws://127.0.0.1:4000/gateway
export CLAWX_EXTERNAL_GATEWAY_ENABLED=1
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

## Safe Mode Behavior
Safe mode must prevent accidental coupling to production OpenClaw or external provider flows. The isolated env layout exists so future smoke work can run against local paths without touching `/home/deploy/.openclaw` or any production runtime directory.

## Allowed Commands
- `git status`
- `git diff --check`
- `bash -n scripts/lah/prepare-clawx-phase1-env.sh`
- `bash scripts/lah/prepare-clawx-phase1-env.sh`
- `test -d` and `test -f` checks against the isolated runtime tree

## Forbidden Commands
- `pnpm install`
- `npm install`
- `pnpm run init`
- any package lifecycle script
- Electron launch
- OpenClaw launch
- Gateway launch
- any download command
- any provider API call
- any command that writes to `/home/deploy/.openclaw`
- any command that mutates production OpenClaw runtime state

## Dependency Install Decision
No dependency install is authorized in BR-B. Controlled-deps work stops at preflight documentation and isolated filesystem prep. If a future BR needs install review, it must be approved separately before any package manager command runs.

## Rollback Plan
- Remove `/home/deploy/lah-stack-runtime/clawx-phase1` if isolated prep must be discarded.
- Revert the BR-B branch commit if the docs or script must be removed.
- Leave BR-A continuity records intact.

## Verification Checklist
- Confirm branch is `br-b/isolated-env-controlled-deps` while preparing.
- Confirm the isolated runtime tree exists after the prep script runs.
- Confirm `git diff --check` is clean.
- Confirm `bash -n scripts/lah/prepare-clawx-phase1-env.sh` passes.
- Confirm no production runtime paths were touched.

## Residual Risks
- Install-chain mutation risk remains until dependency handling is explicitly approved.
- Binary download helpers remain present in the repo and must stay unused.
- Future smoke work still requires strict path discipline.

## Next BR Recommendation
- `CLAWX_BR_C_EXTERNAL_GATEWAY_HEADLESS_SMOKE_ON_LAH_FORK`
