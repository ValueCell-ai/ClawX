---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-agent-database-admission.test.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-supervisor.test.ts
---

Gateway status handling must preserve `gatewayReady` semantics.

Restart performance validation must measure actual packaged-runtime behavior,
including whether the requested shutdown method exists, and must not count
overlapping startup phases or replayed trace records twice. An optimization of
stale-owner checks must retain PID-reuse detection and fail-closed behavior for
permission-denied or unknown process state. A confirmed dead owner can take a
fast path; unknown ownership must never be treated as death for performance.
See `harness/reference/windows-gateway-restart-latency.md` for measured evidence.

Owned Gateway shutdown uses an explicitly enabled private utility-process
channel, independent of WebSocket readiness. Acknowledgement is not completion:
wait for process exit, distinguish clean from abnormal exit, and retain a bounded
fallback when the handler is missing, rejects the request or hangs. Do not enable
this control channel for Doctor, other CLI commands or externally owned Gateways.
The app-quit deadline must allow the same graceful cleanup plus the ordered ACP
stop and forced-stop fallback, rather than truncating healthy runtime cleanup.
An empty Windows spawn broker may skip unsupported Unix process-group discovery
and its advisory retirement delay. Never skip cleanup for tracked child processes,
pending starts or native resources, or reinterpret unknown Unix ownership as empty.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback must not emit duplicate ready transitions or override an explicit pending/failed Agent admission merely because a timeout elapsed.

Every path that marks `gatewayReady: true` (the ready event and the fallback probe) must first
wait for OpenClaw agent-database admission. After an unclean Gateway exit, such as a Windows
forced kill or a crash, OpenClaw admits agent databases in the background. Until admission
completes, `sessions.list` succeeds with an empty catalog, and no `sessions.changed` event
follows. Renderer session hydration keys off `gatewayReady`, so publishing readiness early
replaces the sidebar with that empty list. Main reads pending AND failed Agent refusals
from the loopback `/readyz` probe. `GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS` is the
slow-preparation warning threshold, not permission to mark known pending work ready.
Continue polling without interrupting upgrade migrations. Valid readiness JSON without
`agentDatabases` remains compatible (both older Gateways and modern no-refusal responses).
Unrelated channel health/HTTP 503 must not block local Agent readiness. Unavailable or
malformed probes retry three times before the legacy fallback, and cannot override an
observed admission block, including after reconnect or recovery. The renderer must not
call `/readyz` itself.

Agent model updates must reject before config/auth writes while starting, reconnecting,
or running with `gatewayReady: false`. Preserve offline configuration and legacy
`gatewayReady: undefined` behavior. A failed admission retains its concrete reason.
Only `agent-database-inspection-failed` with reason beginning `prepared model runtime
publication was superseded` permits one automatic restart, and only for a ClawX-owned
Gateway, after startup/restart coordination settles and a delayed re-probe confirms the
failure. Do not restart while any Agent is pending or for mixed/other failures. Scope
callbacks to the connection and cancel them on stop/restart. The budget survives
stop/start and is rearmed only by confirmed admission, never by a successful handshake
or unavailable-probe fallback. Do not replay prompts or modify upgrade backups/Doctor.
See `harness/reference/openclaw-2026-10-5-upgrade.md` (agent database admission).

Managed cold-start readiness must use a finite deadline. When a ClawX-owned process
remains alive without serving the readiness challenge, Main must reclaim that stale
process before scheduling another startup attempt instead of waiting on the same PID.
The deadline follows the Gateway's output: a cold start fails after 180 seconds
without any Gateway output, or after 10 minutes in total. A fixed deadline measured
from spawn killed slow but progressing upgraded Windows starts. Terminating a Gateway
that missed its deadline also exits with code 1 on Windows. That exit is not a config
failure and must not trigger the startup Doctor repair.

Explicit Gateway state-ownership contention must fail before the generic exit-code-1
config-repair fallback, even if the error suggests running Doctor after the owner
stops. Preserve the diagnostic and disable automatic reconnect for that failure.
Do not infer a live Gateway identity from a PID alone, delete ownership locks, or
kill an unverified holder. A mere waiting-progress message is not a terminal failure.

Before handling any startup failure, including a normal child exit caused by stop,
recheck the lifecycle epoch before scheduling repair or retry. Check it again after
asynchronous Doctor preparation and before forking, and after Doctor returns before
updating startup state. A superseded flow must not launch Doctor or another Gateway;
an already-running migration is not forcibly interrupted by this cancellation fence.

The ACP child is a Gateway client that also opens OpenClaw shared state. Main forks
it only after the managed Gateway reports a connection, with a finite wait that fails
the ACP request clearly instead of starting ACP against a Gateway that never came up.
The startup Doctor repair stops any running ACP child before it migrates shared state.

Doctor's exit status is not a readiness signal: it exits non-zero for any unhealthy
plugin even after its migrations succeed. After every startup Doctor run, Main relaunches
the Gateway and lets it decide. A second Doctor run is allowed only when the Gateway
refuses for a different reason, at most twice per startup. The repair timeout must stay
long enough for a full migration on slow Windows machines (30 minutes), because killing
Doctor mid-migration leaves state half-migrated.

Every OpenClaw utility process (Gateway, startup Doctor, Settings Doctor) and the ACP
child run with `OPENCLAW_DEBUG=1`, so a CLI failure prints `Reason:` and the stack.
The utility-process compatibility shim additionally appends bounded `errors[n]` and
`cause` sections to stacks, because an `AggregateError` stack never lists its entries.
