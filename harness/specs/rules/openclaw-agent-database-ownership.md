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

Before persisting provider credentials to a genuinely uninitialized Agent
database, ClawX must invoke the bundled OpenClaw schema initializer. ClawX must
not copy the canonical schema SQL, create a version-1 bootstrap database, or
lower or overwrite a nonzero `PRAGMA user_version` or canonical `schema_meta`
row.

Before a newly created Agent is reported ready for use, Main must inspect all
configured agent databases. A newly initialized database should already match
the bundled schema and must not trigger a Gateway restart. If a pre-existing
database remains below the bundled OpenClaw schema version, Main must use the
managed offline migration and Gateway startup path, then verify that no pending
database remains.

Renderer code must not read, write, migrate, or repair agent SQLite files.
Support and export readers must remain read-only and reject unsupported or
partially rebuilt canonical schemas.
