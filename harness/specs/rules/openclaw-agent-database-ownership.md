---
id: openclaw-agent-database-ownership
title: OpenClaw Agent Database Ownership
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
references:
  - harness/reference/openclaw-session-storage.md
---

OpenClaw owns the canonical agent database schema and all full-version
migrations. ClawX must not implement, copy, or infer OpenClaw's migration SQL.

ClawX may create the bounded auth bootstrap tables required to persist provider
credentials before OpenClaw initializes a new Agent. It may mark a genuinely
uninitialized database as bootstrap schema version 1, but an auth write must
never lower or overwrite a nonzero `PRAGMA user_version` or the canonical
`schema_meta` row.

Before a newly created Agent is reported ready for use, Main must inspect all
configured agent databases. If an auth bootstrap database remains below the
bundled OpenClaw schema version, Main must use the managed offline migration
and Gateway startup path, then verify that no pending database remains.

Renderer code must not read, write, migrate, or repair agent SQLite files.
Support and export readers must remain read-only and reject unsupported or
partially rebuilt canonical schemas.
