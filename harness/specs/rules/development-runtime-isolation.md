---
id: development-runtime-isolation
title: Development runtime isolation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Development profiles must isolate OpenClaw state/config/auth/media/skills and the
ClawX settings/logs/provider stores/instance locks. Respect the central path helpers
and propagate the same resolved environment to Gateway, ACP and CLI children.
Legacy preparation imports compatible configuration and static API credentials,
with fresh sessions and no imported scheduled or pending work. Copy workspaces,
never link them back to shared mutable directories. Preserve migrated sources and
snapshots; back up SQLite with its backup API rather than copying live DB/WAL files.
Do not override HOME or bypass OpenClaw's newer-state guards. Refuse unsafe roots,
symlinks, version mismatches and occupied legacy ports. Profile startup must not
unload or take ownership of the default system Gateway service. Verify both the
isolated profile and unchanged default behavior.

Details: [Development runtime isolation](../../reference/development-runtime-isolation.md).
