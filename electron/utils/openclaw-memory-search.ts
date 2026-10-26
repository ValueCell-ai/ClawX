/**
 * Memory search default seeding for openclaw.json.
 *
 * OpenClaw defaults to the `openai` embedding provider. When no OpenAI key is
 * available, ClawX explicitly selects OpenClaw's keyword-only FTS provider so
 * memory_search remains useful without making an embedding request.
 *
 * OpenClaw 2026.10 moved `agents.defaults.memorySearch` to root
 * `memory.search` and per-agent `memorySearch` to
 * `agents.entries.*.memory.search`. The prelaunch sanitizer moves these
 * schema-preserving legacy locations before Gateway admission.
 */
import { listOpenClawAgentEntryRecords } from './openclaw-agent-roster';

export const MEMORY_SEARCH_FTS_MIGRATION_VERSION = 1;

export type MemorySearchDefaultResult = 'unchanged' | 'seeded' | 'migrated';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAgentMemorySearchOverride(entry: Record<string, unknown>): boolean {
  return entry.memorySearch !== undefined
    || (isRecord(entry.memory) && entry.memory.search !== undefined);
}

function readDefaultMemorySearch(config: Record<string, unknown>): unknown {
  const memory = isRecord(config.memory) ? config.memory : undefined;
  if (memory?.search !== undefined) return memory.search;
  const agents = isRecord(config.agents) ? config.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  return defaults?.memorySearch;
}

/**
 * Move legacy memory-search keys to the OpenClaw 2026.10 locations while
 * preserving their values. The Gateway rejects the old keys during config
 * admission, so waiting for a reactive doctor pass can leave ClawX in a
 * generic exit=1 restart loop.
 */
export function migrateLegacyMemorySearchConfig(config: Record<string, unknown>): boolean {
  let modified = false;
  const agents = isRecord(config.agents) ? config.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;

  if (defaults?.memorySearch !== undefined) {
    const legacy = defaults.memorySearch;
    const memory = isRecord(config.memory) ? config.memory : {};
    if (isRecord(legacy)) {
      if (memory.search === undefined) memory.search = legacy;
      config.memory = memory;
      delete defaults.memorySearch;
      modified = true;
    }
  }

  for (const entry of listOpenClawAgentEntryRecords(agents)) {
    if (entry.memorySearch === undefined) continue;
    const legacy = entry.memorySearch;
    if (!isRecord(legacy)) continue;
    const memory = isRecord(entry.memory) ? entry.memory : {};
    if (memory.search === undefined) memory.search = legacy;
    entry.memory = memory;
    delete entry.memorySearch;
    modified = true;
  }

  return modified;
}

/**
 * True when the user manages memory search themselves: a default
 * `memory.search` (or legacy `agents.defaults.memorySearch`) or any per-agent
 * override exists.
 */
export function hasUserMemorySearchConfig(config: Record<string, unknown>): boolean {
  if (readDefaultMemorySearch(config) !== undefined) return true;
  const agents = isRecord(config.agents) ? config.agents : undefined;
  return listOpenClawAgentEntryRecords(agents).some(hasAgentMemorySearchOverride);
}

/**
 * Seed OpenClaw's explicit FTS-only mode when no memory search config exists.
 * When requested, also migrate the exact legacy ClawX-managed disabled
 * default. Objects with any additional fields and per-agent overrides remain
 * user-owned.
 */
export function ensureMemorySearchFtsDefault(
  config: Record<string, unknown>,
  migrateLegacyDisabledDefault = false,
): MemorySearchDefaultResult {
  const agents = isRecord(config.agents) ? config.agents : undefined;
  if (listOpenClawAgentEntryRecords(agents).some(hasAgentMemorySearchOverride)) {
    return 'unchanged';
  }

  const memorySearch = readDefaultMemorySearch(config);
  if (memorySearch !== undefined) {
    const isLegacyDisabledDefault = isRecord(memorySearch)
      && Object.keys(memorySearch).length === 1
      && memorySearch.enabled === false;
    if (!migrateLegacyDisabledDefault || !isLegacyDisabledDefault) {
      return 'unchanged';
    }
  }

  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  if (defaults) delete defaults.memorySearch;
  const memory = isRecord(config.memory) ? config.memory : {};
  memory.search = { enabled: true, provider: 'none' };
  config.memory = memory;
  return memorySearch === undefined ? 'seeded' : 'migrated';
}
