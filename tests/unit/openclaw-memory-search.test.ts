import { describe, expect, it } from 'vitest';
import {
  ensureMemorySearchFtsDefault,
  hasUserMemorySearchConfig,
  migrateLegacyMemorySearchConfig,
} from '@electron/utils/openclaw-memory-search';

describe('openclaw-memory-search', () => {
  it('moves legacy default and per-agent memorySearch values without changing them', () => {
    const config: Record<string, unknown> = {
      agents: {
        defaults: {
          memorySearch: { enabled: true, provider: 'none' },
        },
        entries: {
          main: {
            memorySearch: { provider: 'openai', model: 'text-embedding-3-small' },
          },
          researcher: {
            memory: { search: { provider: 'custom' } },
            memorySearch: { provider: 'ignored' },
          },
        },
      },
      memory: { flush: { enabled: true } },
    };

    expect(migrateLegacyMemorySearchConfig(config)).toBe(true);
    expect(config).toEqual({
      agents: {
        defaults: {},
        entries: {
          main: {
            memory: { search: { provider: 'openai', model: 'text-embedding-3-small' } },
          },
          researcher: {
            memory: { search: { provider: 'custom' } },
          },
        },
      },
      memory: {
        flush: { enabled: true },
        search: { enabled: true, provider: 'none' },
      },
    });
  });

  it('leaves malformed legacy memorySearch values for OpenClaw Doctor', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: 'invalid' } },
    };

    expect(migrateLegacyMemorySearchConfig(config)).toBe(false);
    expect(config).toEqual({
      agents: { defaults: { memorySearch: 'invalid' } },
    });
  });

  it('seeds FTS-only memory search when no memorySearch config exists', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { model: { primary: 'custom-customfc/gpt-5.5' } } },
    };
    expect(ensureMemorySearchFtsDefault(config)).toBe('seeded');
    expect(config).toEqual({
      agents: {
        defaults: {
          model: { primary: 'custom-customfc/gpt-5.5' },
        },
      },
      memory: { search: { enabled: true, provider: 'none' } },
    });
  });

  it('seeds on a completely empty config', () => {
    const config: Record<string, unknown> = {};
    expect(ensureMemorySearchFtsDefault(config)).toBe('seeded');
    expect(config).toEqual({
      memory: { search: { enabled: true, provider: 'none' } },
    });
  });

  it('never touches existing memory.search config', () => {
    const config: Record<string, unknown> = {
      memory: { search: { provider: 'openai', model: 'text-embedding-3-small' } },
    };
    const before = JSON.parse(JSON.stringify(config));
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect(config).toEqual(before);
  });

  it('never seeds when a keyed per-agent memory.search override exists', () => {
    const config: Record<string, unknown> = {
      agents: {
        entries: {
          main: {},
          research: { memory: { search: { provider: 'openai' } } },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(config));
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect(config).toEqual(before);
  });

  it('never touches existing defaults.memorySearch config', () => {
    const config: Record<string, unknown> = {
      agents: {
        defaults: {
          memorySearch: {
            provider: 'custom-customfc',
            model: 'text-embedding-3-small',
            fallback: 'none',
            remote: { baseUrl: 'https://taolat.com/v1' },
          },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(config));
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect(config).toEqual(before);
  });

  it('never seeds when a per-agent memorySearch override exists', () => {
    const config: Record<string, unknown> = {
      agents: {
        defaults: { model: { primary: 'openai/gpt-4o' } },
        list: [
          { id: 'main' },
          { id: 'research', memorySearch: { provider: 'openai' } },
        ],
      },
    };
    const before = JSON.parse(JSON.stringify(config));
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect(config).toEqual(before);
  });

  it('treats explicit enabled=true as user config', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: { enabled: true } } },
    };
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect((config.agents as { defaults: { memorySearch: { enabled: boolean } } }).defaults.memorySearch.enabled).toBe(true);
  });

  it('treats an empty memorySearch object as user config', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: {} } },
    };
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
  });

  it('migrates only the exact legacy disabled default when requested', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: { enabled: false } } },
    };
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('migrated');
    expect(config).toEqual({
      agents: { defaults: {} },
      memory: { search: { enabled: true, provider: 'none' } },
    });
  });

  it('migrates the exact legacy disabled default after doctor moved it to memory.search', () => {
    const config: Record<string, unknown> = {
      memory: { search: { enabled: false } },
    };
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('migrated');
    expect(config).toEqual({
      memory: { search: { enabled: true, provider: 'none' } },
    });
  });

  it('preserves the exact legacy disabled shape when migration is complete', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: { enabled: false } } },
    };
    expect(ensureMemorySearchFtsDefault(config)).toBe('unchanged');
    expect(config).toEqual({
      agents: { defaults: { memorySearch: { enabled: false } } },
    });
  });

  it('preserves disabled configs with additional user-owned fields', () => {
    const config: Record<string, unknown> = {
      agents: {
        defaults: {
          memorySearch: { enabled: false, provider: 'none' },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(config));
    expect(ensureMemorySearchFtsDefault(config, true)).toBe('unchanged');
    expect(config).toEqual(before);
  });
});
