# Feature Request: Agent-Scoped Skills + Agent-Bound Cron Jobs

## Background

Current behavior in ClawX/OpenClaw integration is effectively global for skills and implicit for cron agent targeting:

- Skills enable/disable uses `skills.update` with only `skillKey` + `enabled`.
- Cron jobs created from ClawX use `payload.kind = agentTurn` and `sessionTarget = isolated`, but no explicit `agentId` is configured in UI/API.

For one-agent setups this is acceptable, but for multi-agent setups (e.g. 7-10 skills split by intent/purpose/goal) this causes:

- skill pollution (all agents see same skill set),
- weak role boundaries,
- less predictable automation behavior.

## Proposal

Introduce two-level skill scope and explicit cron agent binding:

1. Global Skills (shared baseline)
- Available to all agents by default.
- Good for universal utilities (e.g. docs parsing).

2. Agent Skills (agent override layer)
- Per-agent allow/deny list on top of global.
- Supports role-specific skill sets (research/coding/review/ops).

3. Agent-Bound Cron
- Each cron job explicitly stores `agentId`.
- Runtime executes job in that agent context.

## Suggested Data Model

```ts
type SkillPolicy = {
  globalEnabled: string[];          // skill keys
  agentOverrides: Record<string, {  // agentId
    enabled?: string[];             // explicit add
    disabled?: string[];            // explicit remove
  }>;
};

type CronJobExtension = {
  agentId: string;                  // default "main"
};
```

Effective skills for an agent:

`effective(agent) = (globalEnabled - disabled(agent)) U enabled(agent)`

## UI/UX Requirements

1. Skills page:
- Scope switch: `Global` / `Agent`.
- When `Agent` selected, choose target agent and edit overrides.
- Show "effective" badge for current selected agent.

2. Agents page:
- Optional summary card: enabled skill count + overridden skills.

3. Cron page:
- Add `Run as Agent` selector in create/edit dialog.
- List view shows bound agent badge.

## API Requirements (Host API / Main process)

1. Skills
- `GET /api/skills/policy`
- `PUT /api/skills/policy/global`
- `PUT /api/skills/policy/agents/:agentId`
- Keep existing `skills.update` for backward compatibility.

2. Cron
- Extend create/update payload with optional `agentId`.
- Persist and return `agentId` in `/api/cron/jobs`.

## Backward Compatibility

- Existing installations default to:
  - all currently enabled skills -> `globalEnabled`
  - no per-agent overrides.
- Existing cron jobs default `agentId = "main"`.
- If backend/runtime doesn’t support agent-bound execution yet:
  - preserve field in ClawX metadata and surface warning,
  - do not silently drop agent binding in UI.

## Acceptance Criteria

1. A skill can be globally enabled but disabled for a specific agent.
2. A skill can be globally disabled but enabled for a specific agent.
3. Cron job can be created/edited with `agentId`.
4. Cron run history/session key resolves to that agent context consistently.
5. Existing users upgrade without behavior regression.

## Why this matters

- Better separation of intents/purposes/goals per agent.
- Lower accidental tool invocation risk.
- Better reproducibility for scheduled workflows.
- Foundation for policy controls (team/workspace governance).

## Implementation Notes

Likely needs cross-repo coordination:

- ClawX UI + Host API changes (this repo).
- OpenClaw gateway/runtime support for agent-scoped skill resolution and cron agent execution.

If runtime support is not available, ship in phases:

1. ClawX-side model + UI + persistence + warnings.
2. Runtime wiring once OpenClaw supports agent-scoped resolution.
