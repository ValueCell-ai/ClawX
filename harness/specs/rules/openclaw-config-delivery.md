---
id: openclaw-config-delivery
title: OpenClaw Config Delivery
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
references:
  - harness/reference/openclaw-config-delivery.md
---

ClawX must defer runtime config planning to the bundled OpenClaw Gateway.

The Main-owned config coordinator must own the entire read-modify-write transaction. Production helpers must not write the active OpenClaw config and then notify another layer afterward.

When the Gateway is running, the coordinator prefers the runtime-shaped `config.get.config` object as the mutation baseline, applies the caller's mutator, and commits through `config.set` with the returned `hash` as `baseHash`. Source-shaped `raw` is only a compatibility fallback because its redacted secret paths may not align with OpenClaw's write-side runtime snapshot. A successful mutation must not be followed by `SIGUSR1` or a ClawX process restart. Base-hash conflicts retry once from a new snapshot; other RPC failures fail closed instead of performing an out-of-band file write.

Coordinator mutators are replayable transformations. They must not perform filesystem writes, SQLite writes, settings writes, lifecycle actions, or other non-idempotent external effects; preload required external inputs before entering the mutator and perform follow-up effects only after a successful commit.

Gateway WebSocket traces must replace serialized `raw` config-write payloads with a redacted marker. They must not log credentials introduced by a mutator.

When the Gateway is stopped or starting, the same coordinator mutates the resolved config file under the shared config lock. It must not start the Gateway solely to apply a config mutation.

ClawX may replace the Gateway process for process-launch environment or argument changes, explicit user restart, application lifecycle, health/crash recovery, or a failed config-delivery fallback. Provider, Agent, Channel, binding, skill, model, and ordinary plugin-entry config changes must not carry a blanket ClawX restart policy when OpenClaw can plan them.

All coordinator file fallback reads and writes must resolve the active config through `resolveOpenClawConfigPath()` so file delivery and Gateway RPC target the same config. No other production module may write that file.
