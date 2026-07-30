import { describe, expect, it } from 'vitest';
import {
  ensureMemorySearchFtsDefault,
  hasUserMemorySearchConfig,
} from '@electron/utils/openclaw-memory-search';

describe('openclaw-memory-search', () => {
  it('seeds FTS-only memory search when no memorySearch config exists', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { model: { primary: 'custom-customfc/gpt-5.5' } } },
    };
    expect(ensureMemorySearchFtsDefault(config)).toBe('seeded');
    expect(config).toEqual({
      agents: {
        defaults: {
          model: { primary: 'custom-customfc/gpt-5.5' },
          memorySearch: { enabled: true, provider: 'none' },
        },
      },
    });
  });

  it('seeds on a completely empty config', () => {
    const config: Record<string, unknown> = {};
    expect(ensureMemorySearchFtsDefault(config)).toBe('seeded');
    expect(config).toEqual({
      agents: {
        defaults: { memorySearch: { enabled: true, provider: 'none' } },
      },
    });
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
      agents: {
        defaults: { memorySearch: { enabled: true, provider: 'none' } },
      },
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
