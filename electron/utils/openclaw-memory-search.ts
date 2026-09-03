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
 * True when the user manages memory search themselves through the 8.1
 * top-level default, a keyed per-agent override, or Doctor-only legacy input.
 */
export function hasUserMemorySearchConfig(config: Record<string, unknown>): boolean {
  const memory = isRecord(config.memory) ? config.memory : undefined;
  if (memory?.search !== undefined) return true;

  const agents = isRecord(config.agents) ? config.agents : undefined;
  if (!agents) return false;

  const defaults = isRecord(agents.defaults) ? agents.defaults : undefined;
  if (defaults && defaults.memorySearch !== undefined) return true;

  const entries = isRecord(agents.entries) ? Object.values(agents.entries) : [];
  if (entries.some((entry) => (
    isRecord(entry)
    && isRecord(entry.memory)
    && entry.memory.search !== undefined
  ))) return true;

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
  let migratedLegacyDefault = false;
  if (hasUserMemorySearchConfig(config)) {
    const agents = isRecord(config.agents) ? config.agents : undefined;
    const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
    const legacyMemorySearch = defaults?.memorySearch;
    const isLegacyDisabledDefault = isRecord(legacyMemorySearch)
      && Object.keys(legacyMemorySearch).length === 1
      && legacyMemorySearch.enabled === false;
    if (!migrateLegacyDisabledDefault || !isLegacyDisabledDefault) {
      return 'unchanged';
    }
    delete defaults!.memorySearch;
    migratedLegacyDefault = true;
  }

  const memory = (isRecord(config.memory) ? config.memory : {}) as Record<string, unknown>;
  if (memory.search !== undefined) {
    return 'unchanged';
  }
  memory.search = { enabled: true, provider: 'none' };
  config.memory = memory;
  return migratedLegacyDefault ? 'migrated' : 'seeded';
}
