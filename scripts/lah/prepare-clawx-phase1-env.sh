#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_ROOT="/home/deploy/lah-stack-runtime/clawx-phase1"
readonly ROOT="${CLAWX_PHASE1_ROOT:-$DEFAULT_ROOT}"

die() {
  printf 'prepare-clawx-phase1-env: %s\n' "$1" >&2
  exit 1
}

validate_root() {
  case "$ROOT" in
    ""|/|/home/deploy|/home/deploy/.openclaw)
      die "refusing unsafe root: ${ROOT:-<empty>}"
      ;;
    /home/deploy/lah-stack-runtime/clawx-phase1|/home/deploy/lah-stack-runtime/clawx-phase1/*)
      ;;
    *)
      die "root must stay under /home/deploy/lah-stack-runtime/clawx-phase1: $ROOT"
      ;;
  esac
}

write_env_file() {
  local env_dir="$ROOT/env"
  local env_file="$env_dir/clawx-phase1.env"

  mkdir -p \
    "$ROOT/home/.openclaw" \
    "$ROOT/userData" \
    "$ROOT/logs" \
    "$env_dir" \
    "$ROOT/artifacts" \
    "$ROOT/checks"

  cat >"$env_file" <<'EOF'
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
EOF
}

verify_layout() {
  local failures=0
  local -a required_dirs=(
    "$ROOT/home"
    "$ROOT/home/.openclaw"
    "$ROOT/userData"
    "$ROOT/logs"
    "$ROOT/env"
    "$ROOT/artifacts"
    "$ROOT/checks"
  )

  for dir in "${required_dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      printf 'missing directory: %s\n' "$dir" >&2
      failures=$((failures + 1))
    fi
  done

  if [[ ! -f "$ROOT/env/clawx-phase1.env" ]]; then
    printf 'missing env file: %s\n' "$ROOT/env/clawx-phase1.env" >&2
    failures=$((failures + 1))
  fi

  if [[ "$failures" -ne 0 ]]; then
    return 1
  fi

  printf 'prepare-clawx-phase1-env verification summary\n'
  printf '  root: %s\n' "$ROOT"
  printf '  env: %s\n' "$ROOT/env/clawx-phase1.env"
  printf '  directories: ready\n'
}

main() {
  validate_root
  write_env_file
  verify_layout
}

main "$@"
