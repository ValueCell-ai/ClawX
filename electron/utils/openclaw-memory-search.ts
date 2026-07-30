/**
 * Memory search default seeding for openclaw.json.
 *
 * OpenClaw defaults to the `openai` embedding provider. When no OpenAI key is
 * available, ClawX explicitly selects OpenClaw's keyword-only FTS provider so
 * memory_search remains useful without making an embedding request.
 */

export const MEMORY_SEARCH_FTS_MIGRATION_VERSION = 1;

export type MemorySearchDefaultResult = 'unchanged' | 'seeded' | 'migrated';

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
 * Seed OpenClaw's explicit FTS-only mode when no memorySearch config exists.
 * When requested, also migrate the exact legacy ClawX-managed disabled
 * default. Objects with any additional fields and per-agent overrides remain
 * user-owned.
 */
export function ensureMemorySearchFtsDefault(
  config: Record<string, unknown>,
  migrateLegacyDisabledDefault = false,
): MemorySearchDefaultResult {
  const agents = (isRecord(config.agents) ? config.agents : {}) as Record<string, unknown>;
  const list = Array.isArray(agents.list) ? agents.list : [];
  if (list.some((entry) => isRecord(entry) && entry.memorySearch !== undefined)) {
    return 'unchanged';
  }

  const defaults = (isRecord(agents.defaults) ? agents.defaults : {}) as Record<string, unknown>;
  const memorySearch = defaults.memorySearch;

  if (memorySearch !== undefined) {
    const isLegacyDisabledDefault = isRecord(memorySearch)
      && Object.keys(memorySearch).length === 1
      && memorySearch.enabled === false;
    if (!migrateLegacyDisabledDefault || !isLegacyDisabledDefault) {
      return 'unchanged';
    }
  }

  defaults.memorySearch = { enabled: true, provider: 'none' };
  agents.defaults = defaults;
  config.agents = agents;
  return memorySearch === undefined ? 'seeded' : 'migrated';
}
