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
Validation:
  - Focused isolated SQLite and migration regression tests.
  - Communication replay and compare for changed Main/Gateway paths.

Upgrade regression coverage must include intermediate/future schemas, new agents,
compressed messages, absent or stale JSONL, deletion/rename persistence, usage,
channel account discovery, plugin install records in both index formats, and
WAL-inclusive backup. Ordinary chat remains ACP-owned.
