---
id: gateway-diagnostic-logging
title: Automatic Gateway Diagnostic Logging
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - gateway-startup-diagnostics
requiredTests:
  - tests/unit/gateway-startup-stderr.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-process-diagnostics.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/issue-report-api.test.ts
---

Gateway startup and liveness diagnostics must be available in the existing
redacted ClawX log export without user commands, debugging switches, or a
working Gateway RPC connection.

Correlate each accepted startup/restart across shutdown, spawn, handshake and
readiness. Report request-to-ready elapsed time only when the existing readiness
policy has completed Agent admission. Preserve the distinction between a
successful handshake, an admission failure, an interrupted attempt and complete
readiness. Label compatibility fallback evidence accurately. Never add nested
or parallel OpenClaw stage durations as if they were sequential wall time.

Capture startup traces from both stdout and stderr. Line framing must preserve
split UTF-8 characters and partial lines, flush a final unterminated line, and
bound buffered data. Copy only validated stage names and numeric trace fields
from stdout into diagnostic records; do not log arbitrary stdout content.
Phase starts are progress evidence, not proof that a phase remains active or
that the Gateway is ready.

Sample slow-start progress at most once every 30 seconds. Cancel progress
timers on readiness, stop, failure and supersession, and prevent an old process
from contributing to a new attempt. Missed-heartbeat snapshots may use
parent-observed metrics for the owned Gateway PID and system available memory.
Platform API absence, missing processes, invalid numbers and sampling errors
must remain best-effort diagnostics and must not fail lifecycle operations.
Report unavailable values explicitly rather than substituting zero.

Use an explicit field allowlist for version, platform, resource and timing
metadata. Exclude credentials, environment values, host/user identifiers,
command lines, unrelated processes, arbitrary RPC payloads and conversation
content. Keep collection local and included through the existing redacted log
export. This diagnostic enhancement must not enable automatic uploads, full
memory dumps, CPU stack capture or disk tracing.

Diagnostic sampling must not issue extra Gateway RPCs, reset liveness, change
timeouts, alter readiness, or trigger shutdown/restart. Existing heartbeat and
recovery rules remain authoritative. Describe CPU/memory and timing evidence
as observations; do not claim it proves a deadlock, disk bottleneck or a fix
for slow startup without separate validation on the affected runtime.
