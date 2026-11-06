---
id: openclaw-upgrade-persistence
title: OpenClaw upgrade persistence safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Rules:

  - Snapshot migration inputs before startup mutations; use consistent SQLite backups, preserve legacy transcripts and do not discard backups merely because Gateway is ready.
  - OpenClaw owns schema initialization and migration. Never infer a complete schema from app_version or stamp intermediate/future schemas as current.
  - Migrated SQLite state is authoritative over stale legacy files. Decode compressed events and retain stable identity, ordering and timing in bounded historical supplements.
  - Main owns session mutation RPCs and channel delivery context reads. Propagate failures rather than reporting deletion or initialization success prematurely.
  - Write ClawX plugin install records where the current OpenClaw schema reads them. On a migrated state database (`user_version` ≥ 13 with `config_machine_state`), that is the `plugins.installedIndex` row: write it transactionally, back off while the `core:plugin-lifecycle` lease is held, leave invalid rows to Doctor, bump the revision monotonically, and never recreate the retired `installed_plugin_index` table. Fresh and pre-13 databases keep the legacy table that OpenClaw imports. Do not add or alter schema to make a write fit.
  - Read and write main agent credentials where OpenClaw's `auth.sharedStore` owner marker says they live. With `state-db`, use the `authProfiles.store` / `authProfiles.state` rows of `config_machine_state` in a `BEGIN IMMEDIATE` transaction that rechecks the owner. With no row or `legacy-main`, use the main agent database. With an invalid marker, refuse the write. Never leave an `auth-profiles.json` next to a store ClawX has written, because OpenClaw blocks the providers it names. Write that JSON only while OpenClaw's agent schema migration is pending, and merge a leftover JSON into the shared store without overwriting newer shared entries.
  - Before retiring a valid legacy agent roster or default marker, preserve its effective workspaces and the unique marked default Agent's per-surface responsibilities. Follow the pinned runtime's Doctor semantics for channel-wide fallback bindings, heartbeat, systemAgent, authInheritance, fixed sessionStore and talk; preserve explicit owners, disabled settings and per-agent stores. An unmarked first Agent may need a workspace pin but must not acquire invented runtime roles. Leave malformed or ambiguous rosters to Doctor.
  - Agent creation, update and deletion must compare effective paths before and after roster changes and pin only implicit paths that would move. Current keyed rosters follow current runtime ownership, including malformed canonical-roster precedence; UI snapshots and workspace identity/bootstrap maintenance must resolve the same paths. Do not infer historical ownership from directories on disk.
  - An offline SQLite session rename must update the logical entry_json label/updatedAt and their indexed session_nodes columns in one transaction. Validate the existing source against its projected session identity/timestamp, preserve unrelated fields, and fail without mutation on inconsistent rows; never change schema or report success from a projection-only write.
Validation:
  - Focused isolated SQLite and migration regression tests.
  - Communication replay and compare for changed Main/Gateway paths.

Upgrade regression coverage must include intermediate/future schemas, new agents,
compressed messages, absent or stale JSONL, deletion/rename persistence, usage,
channel account discovery, plugin install records in both index formats, and
WAL-inclusive backup. Ordinary chat remains ACP-owned.
