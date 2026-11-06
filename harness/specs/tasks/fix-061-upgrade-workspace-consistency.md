---
id: fix-061-upgrade-workspace-consistency
title: Preserve workspace ownership and audit legacy assumptions during 0.6.1 upgrades
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve effective legacy Agent workspaces and default responsibilities when converting the roster, align current Agent mutations and Main workspace consumers with the runtime, keep offline session rename source and indexes consistent, and independently review remaining upgrade compatibility risks.
touchedAreas:
  - electron/utils/**
  - electron/gateway/**
  - electron/services/sessions-api.ts
  - tests/unit/**
  - tests/e2e/agent-creation-upgrade.spec.ts
  - harness/specs/tasks/fix-061-upgrade-workspace-consistency.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A default Agent that inherited its workspace on 0.6.1 keeps using that directory after upgrade, including in a multi-Agent roster.
  - Named Agents, external workspaces, existing session cwd bindings, credentials and workspace files retain their original identity.
  - Main reports and prepares the same effective workspace that the current runtime uses.
  - Retiring the old default marker preserves channel routing and other ambient responsibilities without replacing explicit owners or disabled settings.
  - An offline session rename remains readable after reconnect because its logical SQLite entry and indexed metadata agree.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/unit/openclaw-agent-roster.test.ts
  - tests/unit/openclaw-legacy-agent-roles.test.ts
  - tests/unit/openclaw-workspace.test.ts
  - tests/unit/strip-first-run.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
acceptance:
  - Compare the effective old and new runtime workspace for implicit main, a named legacy default, inherited defaults.workspace, explicit external paths, and multiple Agents.
  - Migration must be idempotent, preserve explicit paths and unrelated config, and leave malformed or ambiguous rosters for Doctor.
  - Follow the pinned Doctor role migration only for a valid multi-Agent roster with one true default marker and no explicit ownership. Preserve channel-wide fallback routing, heartbeat, systemAgent, authInheritance, fixed sessionStore and talk responsibility; do not override explicit owners, disabled settings, an existing heartbeat policy or per-agent session stores.
  - Roster mutations must not reintroduce path drift when adding a second Agent or renaming/deleting another Agent.
  - Deletion must preserve overlapping surviving Agent workspaces, including directory links, and refuse to remove the sole Agent or an explicitly bound inherited-auth/session-store owner.
  - Agent list responses and workspace identity/bootstrap maintenance read canonical entries first and use the current runtime path resolver, including defaults.workspace and explicit external paths.
  - Already-current rosters must follow current runtime ownership semantics rather than guessing historical workspace ownership from existing directories.
  - Offline SQLite rename validates the source entry and atomically updates entry_json plus projected label/updated_at without losing unrelated fields, changing schema, or modifying inconsistent metadata.
  - Validate existing session histories, cwd ledger, settings and marker-file hashes through an isolated official-0.6.1 to current-build upgrade; never use real user profiles or channel credentials.
  - Review remaining legacy schema, channel, authentication, session and installer assumptions; report confirmed remaining defects separately from changes implemented here.
  - Run focused regressions, TypeScript, lint, task validation and dry-run, harness CI, communication replay/compare and the relevant Electron E2E.
docs:
  required: true
references:
  - harness/reference/local-061-upgrade-validation.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
---

The original reproduction and before/after runtime workspace results are retained
outside the repository at `D:/ClawX-workspace-upgrade-review-20261105/`.
That baseline preserved existing session data but changed the implicit main
workspace; Gateway readiness alone is not acceptance for this repair.

The legacy-role helper is compared with OpenClaw 2026.10.5's
materializeLegacyDefaultAgentRoles. Workspace-only preservation of an unmarked
first Agent must not accidentally grant it the retired marked owner's runtime
roles. Current CRUD and maintenance share the effective-path calculation.

The offline rename regression is independently checked with the bundled v25
session schema and runtime entry parser. The real official-0.6.1 to rebuilt-target
workspace upgrade remains a separate acceptance step; passing isolated tests or
the earlier pre-fix upgrade does not establish that result. Record that run in
the linked reference when it completes.
