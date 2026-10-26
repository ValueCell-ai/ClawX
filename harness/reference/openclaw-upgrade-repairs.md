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

Validation: focused snapshot/readiness tests (14), auth ownership tests using
upstream v16/v25 schemas (8). These do not replace platform upgrade certification.
