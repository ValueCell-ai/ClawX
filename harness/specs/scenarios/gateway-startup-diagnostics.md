---
id: gateway-startup-diagnostics
title: Gateway Startup Diagnostics
type: runtime-diagnostics
ownedPaths:
  - electron/gateway/**
  - electron/utils/openclaw-auth.ts
  - electron/utils/paths.ts
  - src/stores/gateway.ts
  - src/pages/Dreams/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
---

Use this spec when ClawX shows the Gateway as starting/running but UI data does not refresh, Dreams cannot load, or Gateway RPC calls time out after a restart.

## Failure Shape

Treat these as the same incident family until proven otherwise:

- `Gateway ready fallback triggered; probing RPC router before marking ready`
- `Gateway ready fallback RPC router probe failed: RPC timeout: system-presence`
- `[gateway:rpc] doctor.memory.status failed`
- `[gateway:rpc] doctor.memory.dreamDiary failed`
- `chat.history unavailable during gateway startup`
- Port `18789` is listening, but Gateway HTTP or WebSocket RPC does not return.

Important distinction:

- **Port ready** only means the process is listening.
- **Handshake ready** only means ClawX connected to the Gateway socket.
- **RPC ready** means a cheap call such as `system-presence` succeeds.

UI features that depend on Gateway runtime data must prefer RPC-ready evidence over port-ready evidence.

## Fast Triage

1. Confirm the process and ports:

```bash
lsof -nP -iTCP:18789 -sTCP:LISTEN || true
lsof -nP -iTCP:5173 -sTCP:LISTEN || true
```

2. Read recent ClawX logs:

```bash
tail -n 160 "$HOME/Library/Application Support/clawx/logs/clawx-$(date +%F).log"
```

3. Probe a low-cost RPC. Redirect output for memory-related calls because successful responses may contain user data:

```bash
pnpm exec openclaw gateway call system-presence >/tmp/clawx-system-presence.json
pnpm exec openclaw gateway call doctor.memory.status >/tmp/clawx-memory-status.json
pnpm exec openclaw gateway call doctor.memory.dreamDiary >/tmp/clawx-dream-diary.json
```

4. If port is listening but RPC times out, agree on the sampling scope, then sample the Gateway process on macOS:

```bash
sample <gateway-pid> 3 -mayDie >/tmp/clawx-gateway.sample.txt
```

Look for heavy main-thread stacks around `uv_fs_open`, `uv_fs_scandir`, `open`, `read`, `write`, `mkdir`, or repeated plugin/skill initialization frames. This usually means the Gateway event loop is busy with synchronous file work and cannot service RPCs yet.

## Sampling Coordination Protocol

Sampling is diagnostic work against a live local process. Coordinate it explicitly when the user is depending on the current Gateway for active work.

Before sampling, state:

- Which process will be sampled, including PID and why it is believed to be the Gateway.
- The sampling command and duration. Default to `sample <pid> 3 -mayDie`; increase duration only after explaining why.
- Expected impact. A short macOS sample is read-only and usually low impact, but it can produce a large file and may briefly add system load.
- Where the artifact will be written, usually `/tmp/clawx-gateway.sample.txt`.
- What will be inspected and what will not be shared verbatim.

Do not proceed without explicit user agreement when:

- Sampling a process that is not clearly the ClawX-owned Gateway child.
- Increasing sample duration above 5 seconds or repeating samples many times.
- Collecting process environment, open files, memory dumps, trace archives, or any artifact likely to contain secrets.
- Killing, restarting, or force-cleaning Gateway while active tasks, cron jobs, or user-visible work may be running.

Safe-by-default commands:

```bash
lsof -nP -iTCP:18789 -sTCP:LISTEN || true
ps -axo pid,ppid,etime,command | rg -i "openclaw-gateway|Electron|vite" | rg -v "rg -i"
sample <gateway-pid> 3 -mayDie >/tmp/clawx-gateway.sample.txt
```

Avoid by default:

- `env`, `/proc/<pid>/environ`, or full process command dumps that include tokens.
- Full memory dumps.
- Pasting raw `doctor.memory.*` output.
- Pasting complete sample files when only top stack signatures are needed.

When analyzing a sample, report a compact summary:

- Main-thread state: idle, synchronous fs I/O, network connect, CPU-bound JS, or unknown.
- Dominant stack signature, such as `uv_fs_open` under plugin runtime setup.
- Whether the finding points to ClawX-owned prelaunch cleanup, OpenClaw runtime startup cost, active user work, or inconclusive data.
- Recommended next action and whether it requires another user approval.

## Known Causes

### Stale Runtime Dependency Cache

Symptoms:

- Sample shows many synchronous `open` calls while plugin runtime setup is running.
- `~/.openclaw/plugin-runtime-deps/openclaw-*` contains symlink trees pointing at an old worktree or old `node_modules/openclaw`.
- Startup takes much longer than expected before RPC router becomes responsive.

Expected mitigation:

- `cleanupStalePluginRuntimeDeps()` runs before Gateway launch.
- It removes only immediate `openclaw-*` cache roots when symlinks inside point at an OpenClaw package path outside the current bundled package.
- It must not remove arbitrary third-party plugin caches.

### Over-Broad Plugin Allowlist

Symptoms:

- `plugins.allow` contains many provider or media plugins that are not configured or active.
- Gateway mirrors or loads more runtime plugin roots than the current user setup needs.

Expected mitigation:

- Preserve external plugins that are installed, configured in `plugins.entries`, or loaded through `plugins.load` / `plugins.load.paths`.
- Preserve configured bundled plugins, active provider plugins, and core runtime plugins such as `browser`, `acpx`, `device-pair`, and `memory-core`.
- Do not re-add optional provider-like bundled plugins such as `alibaba`, `deepgram`, `elevenlabs`, `groq`, `microsoft`, `phone-control`, `runway`, `talk-voice`, or `voyage` unless configured or active.

### Escaped Skill Symlinks

Symptoms:

- Logs repeatedly show `Skipping escaped skill path outside its configured root`.
- A managed root such as `~/.openclaw/skills` contains symlinks whose realpath points outside that root.

Expected mitigation:

- `cleanupAgentsSymlinkedSkills()` removes symlinks under OpenClaw managed skill roots whose realpath escapes the same root.
- Real directories and symlinks that stay inside the managed skills root must be preserved.
- This cleanup is safe because the hardened OpenClaw loader would reject those escaped entries anyway.

### Startup Work Competing With RPC

Symptoms:

- Gateway handshake completes, but `system-presence`, `chat.history`, or `doctor.memory.*` times out during the first minutes.
- Logs mention cron repair, channel account checks, session lock cleanup, memory-core cron reconciliation, or active embedded/task runs.

Expected behavior:

- Do not mark Gateway fully ready from a pure timer fallback.
- The fallback must probe `system-presence` before emitting ready.
- Heartbeat recovery may defer restart during the initial grace window, but it should not loop restart while the Gateway is still performing startup work.

### Restart Deferral By Active Work

Symptoms:

- Logs mention restart deferral because operations, embedded runs, or task runs are still active.
- A restart takes minutes even though the process is otherwise alive.

Expected handling:

- Explain to users that restart cost is dominated by active Gateway work, not by ClawX UI rendering.
- Avoid triggering full Gateway restart for feature toggles when a narrower config reload or plugin RPC is available.

## Remediation Order

1. Avoid renderer-side transport workarounds. Renderer code must continue to use `host-api` / `api-client`.
2. Preserve `~/.openclaw/openclaw.json`; never replace it with a skeleton on parse errors.
3. Run the startup sanitizers and cleanup hooks locally:

```bash
pnpm exec tsx -e "import { sanitizeOpenClawConfig } from './electron/utils/openclaw-auth.ts'; import { cleanupAgentsSymlinkedSkills, cleanupStalePluginRuntimeDeps } from './electron/gateway/skills-symlink-cleanup.ts'; sanitizeOpenClawConfig().then(() => { console.log(cleanupAgentsSymlinkedSkills()); console.log(cleanupStalePluginRuntimeDeps()); });"
```

4. Restart the app or Gateway and watch for the startup metric:

```text
[metric] gateway.startup {
  "configSyncMs": ...,
  "spawnToReadyMs": ...,
  "readyToConnectMs": ...,
  "totalMs": ...
}
```

5. Confirm RPC readiness:

```bash
pnpm exec openclaw gateway call system-presence >/tmp/clawx-system-presence.json
```

6. Only after `system-presence` succeeds, verify feature-specific RPCs such as Dreams or memory doctor calls.

## Acceptance Criteria

- Gateway starts without restart loops.
- `configSyncMs` stays small relative to total startup time.
- `system-presence` succeeds after startup settles.
- Dreams page can refresh once the Gateway process is running and RPC-ready.
- `doctor.memory.status` and `doctor.memory.dreamDiary` return when Dreams is enabled.
- Logs no longer repeat stale runtime cache or escaped managed-skill symlink warnings for entries ClawX can safely clean.

## Required Regression Coverage

For fixes in this area, run:

```bash
pnpm run typecheck
pnpm run lint:check
pnpm exec vitest run tests/unit/openclaw-auth.test.ts tests/unit/skills-symlink-cleanup.test.ts tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-ready-fallback.test.ts
pnpm exec playwright test tests/e2e/openclaw-dreams.spec.ts
pnpm run build:vite
```

If the change touches Gateway send/receive, fallback, readiness, or chat history, also run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## Reporting Notes

When sharing findings:

- Quote log patterns and timing metrics, not full memory doctor output.
- Redact tokens, account identifiers, device IDs, and channel recipients.
- State whether the failure is port readiness, handshake readiness, or RPC readiness.
- Separate ClawX-owned cleanup issues from OpenClaw runtime initialization cost.
