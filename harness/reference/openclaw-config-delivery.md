# OpenClaw Config Delivery

ClawX bundles OpenClaw 2026.7.1-2. OpenClaw owns the field-level decision between a no-op snapshot update, hot application, subsystem restart, and in-process Gateway restart.

Provider, Agent, Channel, skill, proxy, image-generation, and plugin-install helpers express config changes as mutators. One Main-owned coordinator owns selection of the authoritative baseline and the commit:

1. If Gateway is running, call `config.get` and require its runtime-shaped `config` object and `hash`. The coordinator accepts `raw` only as a compatibility fallback for older responses.
2. Clone the runtime-shaped config, apply the mutator, and call `config.set` with the serialized result and `baseHash: hash`. Using source-shaped `raw` as the preferred baseline can misalign redacted secret paths with OpenClaw's runtime-shaped restore baseline.
3. Retry one base-hash conflict from a fresh `config.get`; fail other RPC errors without writing around the running Gateway. If `config.set` durably wrote the exact requested snapshot but its response was lost when OpenClaw began a native code-1012 reload, verify that persisted snapshot after Gateway leaves running state and accept the existing commit without replaying it.
4. Treat success as converged and do not send `SIGUSR1` or schedule a redundant ClawX process replacement.
5. If Gateway is stopped or starting, apply the same mutator to `resolveOpenClawConfigPath()` under the shared config lock and do not start the Gateway.

This is not a write-then-notify design. No provider, Agent, Channel, skill, proxy, image-generation, or plugin-install helper may write the active config independently. The coordinator prevents a locally read stale snapshot from overwriting concurrent Gateway or CLI config changes.

Gateway WebSocket tracing must redact the complete serialized `raw` payload for `config.set`, `config.patch`, and `config.apply`; key-based structural redaction cannot inspect secrets embedded inside that string.

Coordinator-backed reads follow the same authority rule: prefer the runtime-shaped `config.get.config` object while Gateway is running and use JSON5 file parsing while it is not. Compound views derive all config-backed fields from one snapshot.

OpenClaw 2026.7.1-2 keeps auth-profile SQLite snapshots in memory. After a completed auth-store write batch, ClawX calls `secrets.reload` once when Gateway is running. `config.set` does not replace this refresh. Agent `models.json` needs no explicit RPC because OpenClaw re-reads it when its file fingerprint changes.

Before launch, upgrade compatibility cleanup checks the canonical `state/openclaw.sqlite` update-check row. If it exists, the SQLite row is authoritative and any legacy root `update-check.json` is moved with restrictive permissions under `backups/`; otherwise the JSON remains in place for OpenClaw to import. This cleanup runs after the one-time upgrade snapshot and prevents harmless updater-bookkeeping differences from blocking Gateway readiness or triggering an ineffective doctor retry. The snapshot is removed after either the native ready event or a successful RPC-router readiness fallback, covering the race where a fast Gateway emits readiness before ClawX attaches its WebSocket client.

Full ClawX process replacement remains necessary after a successful coordinator commit when values are injected only at process creation, including proxy environment changes, or for explicit manual lifecycle and health/crash recovery. OpenClaw config categories must not be duplicated as a ClawX restart whitelist.
