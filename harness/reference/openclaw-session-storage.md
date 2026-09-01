# OpenClaw Session Storage

OpenClaw 2026.8.1 owns active session metadata and transcript state through its
SQLite-backed Gateway contracts. ClawX must not edit active `sessions.json` or
transcript JSONL files.

Main-process services use `sessions.list`, `sessions.describe`,
`sessions.preview`, `sessions.patch`, `sessions.delete`, and `chat.history` for
conversation history, labels, deletion, summaries, token usage, Cron replay,
channel target discovery, delivery-account resolution, and issue-report
exports. File readers remain only as compatibility fallbacks for legacy
archives and tests; JSONL generated for a support ZIP is an export format, not
the active store.

Before the first 2026.8.1 Gateway launch, ClawX snapshots every discovered
agent's `sessions.json`, transcript/reset/trajectory files, SQLite databases
and sidecars, credentials, exec approvals, cron state, and canonical config.
Doctor then imports and validates all-agent session state while the Gateway is
stopped. A failed or interrupted migration preserves both source data and the
external recovery checkpoint and blocks Gateway startup.

Deleting a conversation calls `sessions.delete` with transcript deletion
enabled. Renaming calls `sessions.patch`. Missing deletes are idempotent.
Downgrading to a JSONL-era runtime is not automatic: restore the retained
pre-migration checkpoint before starting the older runtime.
