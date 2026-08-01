# OpenClaw Config Delivery

ClawX bundles OpenClaw 2026.7.1. OpenClaw owns the field-level decision between a no-op snapshot update, hot application, subsystem restart, and in-process Gateway restart.

Provider, Agent, Channel, skill, proxy, image-generation, and plugin-install helpers express config changes as mutators. One Main-owned coordinator owns selection of the authoritative baseline and the commit:

1. If Gateway is running, call `config.get` and require a non-empty `raw` snapshot and `hash`.
2. Parse that snapshot, apply the mutator, and call `config.set` with the changed raw value and `baseHash: hash`.
3. Retry one base-hash conflict from a fresh `config.get`; fail other RPC errors without writing around the running Gateway.
4. Treat success as converged and do not send `SIGUSR1` or replace the process.
5. If Gateway is stopped or starting, apply the same mutator to `resolveOpenClawConfigPath()` under the shared config lock and do not start the Gateway.

This is not a write-then-notify design. No provider, Agent, Channel, skill, proxy, image-generation, or plugin-install helper may write the active config independently. The coordinator prevents a locally read stale snapshot from overwriting concurrent Gateway or CLI config changes.

Coordinator-backed reads follow the same authority rule: use the `config.get` snapshot while Gateway is running and JSON5 file parsing while it is not. Compound views derive all config-backed fields from one snapshot.

OpenClaw 2026.7.1 keeps auth-profile SQLite snapshots in memory. After a completed auth-store write batch, ClawX calls `secrets.reload` once when Gateway is running. `config.set` does not replace this refresh. Agent `models.json` needs no explicit RPC because OpenClaw re-reads it when its file fingerprint changes.

Full ClawX process replacement remains necessary after a successful coordinator commit when values are injected only at process creation, including proxy environment changes, or for explicit manual lifecycle and health/crash recovery. OpenClaw config categories must not be duplicated as a ClawX restart whitelist.
