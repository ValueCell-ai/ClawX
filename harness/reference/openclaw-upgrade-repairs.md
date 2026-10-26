# OpenClaw 2026.10.5 persistence repairs

Task: `harness/specs/tasks/repair-openclaw-2026-10-5-upgrade.md`.

## Snapshot and schema ownership

Startup snapshots migration inputs before extension/bootstrap/auth writers. SQLite
online backup includes committed WAL; legacy session files, credentials and media
are retained. Backup failure aborts startup and readiness no longer removes the
snapshot. Runtime binaries, external/symlink workspaces are not a full-machine
backup. See the three README upgrade sections for retention and secret handling.

Auth writes preserve existing schema metadata. Startup repair is limited to both
markers being 1, app_version exactly 2026.10.5, matching agent ownership, and a full
current-structure check using the bundled runtime's schema contract. A standalone
`.clawx-before-schema-repair` SQLite copy is made before this known-marker repair.
Intermediate schemas remain for upstream doctor; future schemas reject auth writes.
The private upstream structural helper is isolated in
`electron/utils/openclaw-persistence-runtime.ts` and tested against the installed
pinned runtime, rather than duplicating its schema or relying on hashed filenames.

## Fresh agent initialization

New databases are initialized by the public bundled `plugin-sdk/sqlite-runtime`
initializer in a private staging file, then published with an exclusive hard link.
A concurrently runtime-created database is never overwritten. No hand-written v1
schema is created. Agent provisioning imports inherited credentials, and the host
create request awaits provider sync instead of acknowledging before auth is ready.

## SQLite consumers

`electron/utils/openclaw-transcript-sqlite.ts` is the single bounded reader used by
session summaries, history supplements, turn timings and token usage. It decodes
`event_zstd`, uses the current SQLite session mapping first, and only falls back to
JSONL when no SQLite database exists. Session deletion/rename uses Gateway
`sessions.delete`/`sessions.patch` when connected and a guarded SQLite fallback for
offline maintenance/tests; it does not claim success after a failed mutation.
Channel target discovery and Cron account recovery likewise prefer SQLite
`entry_json` and do not let stale JSONL override a migrated agent.

Validation: focused snapshot/readiness tests (14); auth, agent configuration and
host-service suites (209); consumer suites (39); review migration consumers (15);
real Electron UI agent creation verifies schema 25, inherited credentials and
SQLite integrity (1). These do not replace live-model chat or platform upgrade
certification. The three README upgrade sections remain accurate; this repair does
not add a new user workflow.
