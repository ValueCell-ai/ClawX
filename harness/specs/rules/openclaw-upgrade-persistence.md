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
Validation:
  - Focused isolated SQLite and migration regression tests.
  - Communication replay and compare for changed Main/Gateway paths.

Upgrade regression coverage must include intermediate/future schemas, new agents,
compressed messages, absent or stale JSONL, deletion/rename persistence, usage,
channel account discovery and WAL-inclusive backup. Ordinary chat remains ACP-owned.
