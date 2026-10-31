# Development runtime isolation

The migration branch continues to use the existing migrated OpenClaw directory.
`pnpm dev:legacy` prepares and starts the pre-upgrade branch in
`~/.clawx-dev/legacy/{openclaw,clawx}` with Gateway 19789, Vite 5174 and CDP 9224.
Preparation first creates a private, immutable-by-convention migrated-state backup
outside the source tree, using SQLite online backups. It imports configuration,
Agent metadata and static API credentials from the version-matching pre-migration
snapshot, copies workspaces, and starts fresh sessions. OAuth/IM credentials and
queued/scheduled work are not imported, preventing stale refreshes or repeated work.
Existing legacy profiles are reused, never silently reinitialized.

Web search is initially disabled because the snapshot may reference search plugins
that are not installed in the legacy profile. Automatic Doctor repair is also
disabled so startup cannot modify shared shell integration. These defaults do not
prevent configuring and testing capabilities explicitly in the isolated profile.

All managed paths must resolve through the Main path helpers. ClawX userData is
set before acquiring singleton locks. Legacy env overrides are validated before
startup, inherited by child processes, and use independent ports. The default
launch path remains unchanged. Do not set HOME, weaken version guards, or restore
the old snapshot over migrated data. Separate Git worktrees and node_modules are
recommended for the two runtime versions; worktrees alone do not isolate data.
