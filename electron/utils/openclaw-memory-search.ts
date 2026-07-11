/**
 * Memory search default seeding for openclaw.json.
 *
 * OpenClaw enables semantic memory search by default with the `openai`
 * embedding provider, so a user without an OpenAI key gets doctor errors and
 * a broken memory_search tool. ClawX seeds `agents.defaults.memorySearch =
 * { enabled: false }` at Gateway prelaunch — but only when the user has no
 * memorySearch config anywhere (global defaults or per-agent overrides).
 * Existing user config is never modified.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True when the user manages memorySearch themselves: either
 * `agents.defaults.memorySearch` or any `agents.list[].memorySearch` exists.
 */
export function hasUserMemorySearchConfig(config: Record<string, unknown>): boolean {
  const agents = isRecord(config.agents) ? config.agents : undefined;
  if (!agents) return false;

  const defaults = isRecord(agents.defaults) ? agents.defaults : undefined;
  if (defaults && defaults.memorySearch !== undefined) return true;

  const list = Array.isArray(agents.list) ? agents.list : [];
  return list.some((entry) => isRecord(entry) && entry.memorySearch !== undefined);
}

/**
 * Seed `agents.defaults.memorySearch = { enabled: false }` when the user has
 * no memorySearch config at all. Mutates `config` in place and returns true
 * when a change was made. Never touches existing memorySearch objects.
 */
export function ensureMemorySearchDisabledDefault(config: Record<string, unknown>): boolean {
  if (hasUserMemorySearchConfig(config)) return false;

  const agents = (isRecord(config.agents) ? config.agents : {}) as Record<string, unknown>;
  const defaults = (isRecord(agents.defaults) ? agents.defaults : {}) as Record<string, unknown>;

  defaults.memorySearch = { enabled: false };
  agents.defaults = defaults;
  config.agents = agents;
  return true;
}
