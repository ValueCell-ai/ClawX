# Gateway Stability And Hot-Reload Redesign

Status: approved design reference, authored 2026-07-22. Implementation tracked by task `gateway-hot-config-and-im-decoupling`.

Related scenarios: `gateway-backend-communication`, `gateway-startup-diagnostics`, `plugin-lifecycle-management`

Related rules: `gateway-readiness-policy`, `api-client-transport-policy`, `backend-communication-boundary`, `channel-plugin-migration-guards`, `comms-regression`

Related tasks: `gateway-hot-config-and-im-decoupling`

## 1. Problem Statement

ClawX wraps the OpenClaw runtime, and today three coupled problems make the desktop experience feel unstable:

1. **Config changes and model switches frequently restart the Gateway.** A restart can take minutes, during which chat, channels, and cron are all unavailable.
2. **IM channels (Telegram, Discord, WhatsApp, Feishu, DingTalk, WeCom, …) run inside the Gateway process.** Every Gateway restart drops every IM session and forces re-login/reconnect, so the Gateway must be kept alive at all costs — which conflicts directly with point 1.
3. **The restart itself is slow** because ClawX front-loads plugin installation, config sanitation, and Python/uv warmup onto every spawn, and then waits on a very long readiness loop.

The goal of this redesign: **a configuration or model change should apply in ≤ 2 seconds without visible interruption, IM sessions should survive all config changes, and a genuinely required Gateway restart should complete in ≤ 15 seconds p50.**

## 2. Current-State Analysis

### 2.1 Where forced restarts come from

The intended hot path already exists: `GatewayManager.reload()` (`electron/gateway/manager.ts`) sends SIGUSR1 to the Gateway when the `gateway.reload` policy in `~/.openclaw/openclaw.json` allows it. But many mutation paths bypass it:

| Change | Behavior today | Source |
|---|---|---|
| Save/update provider, set default provider | `debouncedReload` (hot when policy allows) | `electron/services/providers/provider-runtime-sync.ts` `scheduleGatewayRefresh()` |
| Delete provider | forced `debouncedRestart` (`mode: 'restart'`) | same file |
| OAuth success | `debouncedRestart(8000)` | provider IPC handlers |
| Agent model override (chat model picker) | `debouncedReload` | `electron/services/agents-api.ts` |
| Agent delete | full `restart()` | `electron/services/agents-api.ts` |
| Save almost any IM channel | forced `debouncedRestart(150)` via `FORCE_RESTART_CHANNELS` (15+ channel types) | `electron/services/channels-api.ts` |
| Proxy settings | immediate `restart()` | `electron/services/settings-api.ts` |
| Any reload on Windows | always degraded to full restart (no SIGUSR1) | `electron/gateway/manager.ts` |
| Reload policy `restart`/`off`, or Gateway connected < 8s | degraded to restart / skipped | `electron/gateway/manager.ts` |

Net effect: the two highest-frequency user actions — switching models and editing channel/provider settings — land on the restart path far more often than the design intends, and on Windows they always do.

### 2.2 Why one restart takes minutes

Every spawn re-runs the full pre-launch pipeline in `electron/gateway/config-sync.ts` (`prepareGatewayLaunchContext()` / `syncGatewayConfigBeforeLaunch()`) and `electron/gateway/startup-orchestrator.ts`:

1. Plugin install/upgrade copies into `~/.openclaw/extensions/` for every mapped channel plugin, plus stale-copy cleanup and dependency symlinking (`ensureExtensionDepsResolvable`).
2. Config sanitation, skills symlink cleanup, stale runtime-dep pruning.
3. `warmupManagedPythonReadiness()` (`electron/gateway/supervisor.ts`) — `uv python install 3.12` when missing; slow on first run or bad mirrors.
4. `waitForGatewayReady()` (`electron/gateway/ws-client.ts`) — up to 2400 × 200 ms ≈ **8 minutes** of polling budget.
5. On Windows, `waitForPortFree()` — up to 30 s of TIME_WAIT waiting.
6. Inside the Gateway, every IM channel re-initializes: Telegram/Discord reconnect, WhatsApp session resume, etc.
7. If config is invalid, `runOpenClawDoctorRepair()` adds a doctor pass and retry.

None of steps 1–3 depend on the *content* of the change that triggered the restart; they are unconditional maintenance chores sitting on the critical path.

### 2.3 The IM coupling

ClawX writes channel config into `openclaw.json` and installs channel plugins, but the channel connections themselves live **inside** the Gateway process (`CHANNEL_PLUGIN_MAP` in `electron/gateway/config-sync.ts`). Consequences:

- Any restart (including ones triggered by unrelated provider/proxy edits) drops all IM sessions.
- The heartbeat watchdog (`startPing()`, 4 missed pongs → restart) can convert a transient WS stall into a full IM outage.
- Keepalive pressure and hot-reload pressure fight each other: the process we must keep alive is the process we keep restarting.

## 3. Comparative Research

Five reference systems were surveyed (July 2026). The patterns below are what each contributes to this design.

### 3.1 NousResearch/hermes-agent (Hermes Desktop)

Electron + React shell over a headless `hermes serve` Python backend speaking JSON-RPC/WebSocket (`tui_gateway`). Key practices:

- **One shared runtime, many surfaces.** Desktop, CLI, browser dashboard, and seven messaging platforms all attach to the same gateway process and share config/sessions/skills/memory. The desktop never forks runtime state; it is "one more surface".
- **`backendPool` for profile/identity switching.** Switching agent profiles does not restart the active backend; the shell manages a pool of concurrent backend processes and re-points the UI connection. Switching is a *connection-level* operation, not a *process-level* one.
- **Backend resolution ladder + bootstrap model.** The shell resolves a runnable backend through an ordered ladder and provisions the environment once (first-run install into `~/.hermes`), not on every start.

### 3.2 netease-youdao/LobsterAI

Electron + React desktop agent built on OpenClaw — the closest analogue to ClawX, and the most instructive for the IM problem:

- **Product/runtime split ("Cowork" vs OpenClaw).** LobsterAI keeps sessions, messages, permissions, artifacts, memory metadata, and IM bindings in the desktop app (SQLite, `src/main/coworkStore.ts`), and uses OpenClaw strictly as the execution runtime behind `openclawEngineManager` / `openclawRuntimeAdapter`.
- **IM gateways live in the Electron Main process** (`src/main/im/`): connection, status, delivery, session mapping, media, and pairing are Main-owned. OpenClaw restarts do not drop DingTalk/Feishu/Telegram/Discord connections; Main queues and re-routes when the runtime returns.
- **One-way config rendering.** `openclawConfigSync.ts` renders desktop state into OpenClaw config; the desktop store is the single source of truth, and the runtime is treated as disposable/repairable (`runtime repair` is a first-class Main service).

### 3.3 OpenAI Codex (Codex App Server)

The Codex desktop app, VS Code extension, TUI, and web all drive one long-lived `codex app-server` process over bidirectional JSON-RPC (JSONL over stdio, or WebSocket/Unix socket):

- **Model and policy are per-turn parameters, not process state.** `turn/start` carries the model, approval policy, and environment for that turn. Switching models never restarts anything — it changes the next request. This is the single most important pattern for ClawX's model-switching pain.
- **Thread manager isolates sessions.** One core session per thread; a misbehaving thread does not require restarting the server.
- **Versioned, backward-compatible protocol.** Clients bundle a pinned server binary and upgrade the server independently of the client; `initialize` handshake gates the connection.
- **Health probes are part of the surface** (`/healthz`, `/readyz`), separating "port open" from "ready to serve".

### 3.4 WorkBuddy (work-buddy / Tencent WorkBuddy)

Local-first agent runtime with a **sidecar supervisor** pattern:

- A gateway (MCP server on a fixed port) exposes a small, fixed tool surface; capabilities are discovered dynamically at runtime from a local knowledge store, so adding/changing capabilities never redeploys the gateway.
- **The supervisor owns the fleet:** messaging, embedding, Telegram bot, and dashboard run as separate persistent services on distinct ports; the supervisor starts them on demand, restarts them on failure, and health-checks them on a schedule "so the gateway can assume its dependencies are up". A failure or restart in one service (e.g. Telegram) never takes down the others.
- Tencent's WorkBuddy desktop similarly splits chat-surface bots (enterprise IM) from the local execution agents.

### 3.5 "codecode" — closest public matches: Claude Code desktop & Tencent CodeBuddy

No public project named exactly "codecode" was identifiable; the closest matches by name and category were surveyed instead:

- **Claude Code (desktop redesign, 2026):** multiple concurrent sessions, each in its own worktree/sidebar entry; a persistent background daemon mode (KAIROS) keeps the agent alive across sessions while individual session runtimes start and stop cheaply. Session lifecycle is decoupled from daemon lifecycle.
- **Tencent CodeBuddy / multi-agent workspaces (e.g. codeg):** a shared Rust/desktop core owns state, chat channels (Telegram/Lark), and persistence, while agent CLIs are spawned per-task as disposable children. Again: durable connectivity in the shell, disposable compute in the runtime.

### 3.6 Cross-cutting lessons

1. **Configuration is data, not process state.** The best systems (Codex) pass model/policy per request; the good ones (Hermes, LobsterAI) hot-render config and treat restart as a repair action, never a config-apply action.
2. **Durable connections belong to the most durable process.** Every surveyed system keeps IM/chat-channel connectivity in a process that outlives the agent runtime (LobsterAI Main, WorkBuddy messaging sidecar, codeg core).
3. **Supervise a fleet, not a monolith.** WorkBuddy's sidecar supervisor and Hermes' backendPool both show per-service lifecycle beats one all-or-nothing process.
4. **Bootstrap once, launch fast.** Environment provisioning (Python, plugins, deps) happens at install/first-run or in the background — never on the config-change critical path.
5. **Readiness is a protocol, not a port probe.** Explicit ready states (Codex `/readyz`, Hermes handshake) let the UI degrade gracefully instead of blocking for minutes.

## 4. Design Principles For ClawX

1. **Reload is the rule; restart is the exception.** Every config mutation must first attempt an in-process apply; restart is reserved for changes the runtime provably cannot absorb.
2. **Model selection is request-scoped.** Follow Codex: the active model rides with the session/turn, not with the process.
3. **The Gateway process is disposable; connectivity is not.** IM session continuity must not depend on Gateway uptime.
4. **Nothing unconditional on the spawn path.** Pre-launch work must be incremental, cached, and skippable.
5. **A required restart is invisible when possible.** Prefer blue/green swap over stop-the-world.

## 5. Target Architecture

```text
┌─ Renderer (React) ──────────────────────────────────────────┐
│ host-api / host-events / stores                             │
└──────────────┬──────────────────────────────────────────────┘
               │ typed IPC (host:invoke)
┌──────────────▼──────────────────────────────────────────────┐
│ Electron Main                                               │
│  ConfigService (single writer, versioned apply plans)       │
│  RuntimeSupervisor (per-service lifecycle, blue/green)      │
│  ChannelHost supervisor (IM continuity)          [Phase 3]  │
└───────┬──────────────────────────────┬──────────────────────┘
        │ ws://:18789 (+ SIGUSR1/RPC)  │ supervised child
┌───────▼───────────────┐   ┌──────────▼───────────────┐
│ OpenClaw Gateway      │   │ Channel Host (OpenClaw    │
│ agents, tools, skills │   │ channels split out)       │
│ (restartable, fast)   │   │ (long-lived, rarely dies) │
└───────────────────────┘   └───────────────────────────┘
```

### 5.1 Phase 1 — Hot config apply (kills most restarts)

**Owner: `electron/services/**`, `electron/gateway/manager.ts`.**

1. **Introduce a config apply planner.** Replace scattered `debouncedReload`/`debouncedRestart` call sites with one Main-side `applyConfigChange(change)` that classifies each mutation into `hot` (RPC/no-op), `reload` (SIGUSR1 or reload RPC), or `restart` (process). The classification table lives in one module and is unit-tested, replacing today's implicit policy spread across `provider-runtime-sync.ts`, `channels-api.ts`, `agents-api.ts`, and `settings-api.ts`.
2. **Make model switching request-scoped where the runtime allows.** Agent model overrides already only rewrite `agents.list[].model.primary`; verify against the pinned OpenClaw version whether a session-level model parameter or a narrower `config.apply`-style RPC exists, and prefer it. Where the file+reload path must remain, guarantee it is a *reload*, never a restart, on all platforms.
3. **Fix Windows reload.** SIGUSR1 is unavailable on Windows, so add a reload RPC path (Gateway WS command) as the primary mechanism on all platforms, with SIGUSR1 as fallback. This removes the "Windows always restarts" degradation.
4. **Demote forced restarts.** Re-audit `FORCE_RESTART_CHANNELS` (currently 15+ types → restart), provider delete, OAuth success, and proxy change. Each entry must carry a documented reason why reload is insufficient for the pinned OpenClaw version; entries without a proven reason move to `reload`. Proxy changes only need restart when the Gateway process env must change — detect that case instead of assuming it.
5. **Remove the "<8s since connect" reload skip** in favor of queueing the reload until the ready event, so early config edits are not silently dropped or escalated.

### 5.2 Phase 2 — Take restart off the critical path

**Owner: `electron/gateway/config-sync.ts`, `startup-orchestrator.ts`, `supervisor.ts`, `ws-client.ts`.**

1. **Manifest-hash the pre-launch pipeline.** Compute a hash over (bundled plugin versions, channel set, config-sanitation inputs); persist it next to the extensions dir. On spawn, skip plugin copy/cleanup/symlink work when the hash is unchanged. First-run and upgrade still pay full cost; steady-state restarts pay ~0.
2. **Move uv/Python warmup off the spawn path.** Run `warmupManagedPythonReadiness()` at app start and after app updates (background, throttled), not inside every Gateway launch.
3. **Budgeted, observable readiness.** Split `waitForGatewayReady` into: port-ready → handshake-ready → RPC-ready milestones (matching `gateway-startup-diagnostics` terminology), emit each as a host event so the UI shows progress instead of a spinner, and cap the total budget (default 60 s) with an explicit degraded state instead of the current 8-minute silent loop.
4. **Blue/green restart for config-driven restarts.** When the planner decides `restart`: launch a new Gateway on an ephemeral port with the new config, wait for handshake-ready, atomically re-point `GatewayManager`'s WS and port, then terminate the old process. Crash-triggered restarts keep today's in-place path (the port is already free). IM channels are single-owner per account, so blue/green launches the replacement with `OPENCLAW_SKIP_CHANNELS=1` and hands channel ownership over at cutover — or is bypassed entirely for channel-affecting changes until Phase 3 lands.
5. **Windows port strategy.** Blue/green on an ephemeral port also eliminates the 30 s `waitForPortFree` TIME_WAIT stall for planned restarts.

### 5.3 Phase 3 — Decouple IM connectivity from Gateway lifetime

Two viable end-states were evaluated:

- **Option A (LobsterAI model): Main-owned IM gateways.** Move channel connections into Electron Main services with a delivery/session-mapping layer to the runtime. Maximum continuity, but re-implements OpenClaw's channel plugins and their update stream — high, ongoing cost.
- **Option B (WorkBuddy model): split Channel Host process.** Run OpenClaw's channel subsystem as a second supervised child process ("Channel Host") owned by `RuntimeSupervisor`, connected to the agent Gateway over the loopback WS. The agent Gateway becomes freely restartable; the Channel Host restarts only for channel config changes affecting *that* channel, and holds/queues inbound messages during agent Gateway swaps.

**Recommendation: Option B**, sequenced after Phases 1–2. Rationale: it preserves OpenClaw's channel implementations (no re-implementation risk, keeps `channel-plugin-migration-guards` semantics), matches the sidecar-supervisor pattern proven by WorkBuddy, and the WhatsApp login flow is already Main-owned (`electron/utils/whatsapp-login.ts`) so ClawX already has precedent for channel logic outside the Gateway. If the pinned OpenClaw version cannot run channels detached from the main gateway process, the fallback is per-channel restart isolation inside the planner: a channel edit reloads/restarts only when that channel's plugin requires it, and never restarts the agent runtime.

Note: Phases 1–2 alone remove most IM downtime, because the dominant cause of channel drops is restarts triggered by *unrelated* config changes. Phase 3 addresses the residual cases (agent Gateway crash, OpenClaw upgrade).

### 5.4 Supervision and health model adjustments

- Heartbeat escalation gains one intermediate step: after 4 missed pongs, attempt WS reconnect to the live process before killing it (a stalled event loop and a dead process are different failures).
- `RuntimeSupervisor` tracks per-service state (agent Gateway, Channel Host) with independent backoff and cooldown, replacing the single-process assumption in `restart-governor.ts` / `lifecycle-controller.ts`.
- Startup metrics (`gateway.prelaunch`, `gateway.startup`) gain per-stage timings (plugin sync, uv warmup, port-ready, handshake-ready, RPC-ready, channel-ready) so regressions are attributable.

## 6. Migration Plan

| Step | Scope | Files (primary) | Risk |
|---|---|---|---|
| 1. Config apply planner + classification table | Phase 1 | new `electron/gateway/config-apply-planner.ts`; call-site edits in `provider-runtime-sync.ts`, `channels-api.ts`, `agents-api.ts`, `settings-api.ts` | Low — behavior-preserving refactor first, then per-entry demotions with tests |
| 2. Reload RPC + Windows parity | Phase 1 | `manager.ts`, `ws-client.ts` | Medium — depends on pinned OpenClaw reload surface; verify per release |
| 3. Prelaunch manifest hashing | Phase 2 | `config-sync.ts` | Low — cache-invalidation bugs mitigated by hash covering all inputs + `--force` escape hatch |
| 4. Background uv warmup | Phase 2 | `supervisor.ts`, app bootstrap in `electron/main/index.ts` | Low |
| 5. Readiness milestones + budget | Phase 2 | `ws-client.ts`, `startup-orchestrator.ts`, host events, `src/stores/gateway.ts` | Low — UI-visible, needs E2E spec |
| 6. Blue/green restart | Phase 2 | `startup-orchestrator.ts`, `manager.ts`, `process-launcher.ts` | Medium — port re-pointing, single-owner channels; gated behind planner decisions |
| 7. Channel Host split | Phase 3 | `RuntimeSupervisor` (new), `config-sync.ts` channel wiring | High — depends on OpenClaw capability; ship behind a setting, default off until proven |

Every step that touches communication paths runs `pnpm run comms:replay` + `pnpm run comms:compare` (rule `comms-regression`), plus the regression set from `gateway-startup-diagnostics`.

## 7. Success Metrics

| Metric | Today (observed/budgeted) | Target |
|---|---|---|
| Model switch apply latency | reload (seconds) or restart (minutes); always restart on Windows | ≤ 1 s, no process restart, all platforms |
| Provider/channel config apply | mostly restart (minutes) | ≤ 2 s hot/reload for all demoted entries |
| Planned Gateway restart p50 | minutes (prelaunch + readiness) | ≤ 15 s; UI shows staged progress |
| IM downtime on unrelated config change | full reconnect per restart | 0 (no restart triggered) |
| IM downtime on required agent-runtime restart | full reconnect | 0 after Phase 3 (Channel Host unaffected) |
| Readiness wait ceiling | ≈ 8 min silent | 60 s budget with explicit degraded state |

## 8. Risks And Open Questions

- **OpenClaw reload surface:** the exact set of config keys the pinned OpenClaw version can absorb via SIGUSR1/reload RPC (especially per-channel) must be verified per release; the planner's classification table is the single place that encodes this and must be re-audited on every OpenClaw bump.
- **Single-owner channels:** blue/green must never run two processes owning the same channel account concurrently (`channel-plugin-migration-guards`). Cutover ordering is: new process handshake-ready → old process channel shutdown → new process channel enable.
- **External/user-managed gateways:** ClawX can attach to a pre-existing Gateway on 18789; planner decisions must degrade to reload-only (never kill a process ClawX does not own — `terminateOwnedGatewayProcess` semantics are preserved).
- **AGENTS.md/README drift:** README architecture sections and AGENTS.md transport notes must be updated when Phases land (rule `docs-sync`); AGENTS.md still references the removed `WS -> HTTP -> IPC` fallback and should be corrected in the first implementation PR.
