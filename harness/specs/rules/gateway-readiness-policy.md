---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
---

Gateway status handling must preserve `gatewayReady` semantics.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Managed cold-start readiness must use a finite deadline. When a ClawX-owned process
remains alive without serving the readiness challenge, Main must reclaim that stale
process before scheduling another startup attempt instead of waiting on the same PID.

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
