import { describe, expect, it } from 'vitest';
import {
  ensureMemorySearchDisabledDefault,
  hasUserMemorySearchConfig,
} from '@electron/utils/openclaw-memory-search';

describe('openclaw-memory-search', () => {
  it('seeds memorySearch.enabled=false when no memorySearch config exists', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { model: { primary: 'custom-customfc/gpt-5.5' } } },
    };
    expect(ensureMemorySearchDisabledDefault(config)).toBe(true);
    expect(config).toEqual({
      agents: {
        defaults: {
          model: { primary: 'custom-customfc/gpt-5.5' },
          memorySearch: { enabled: false },
        },
      },
    });
  });

  it('seeds on a completely empty config', () => {
    const config: Record<string, unknown> = {};
    expect(ensureMemorySearchDisabledDefault(config)).toBe(true);
    expect(config).toEqual({
      agents: { defaults: { memorySearch: { enabled: false } } },
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
    expect(ensureMemorySearchDisabledDefault(config)).toBe(false);
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
    expect(ensureMemorySearchDisabledDefault(config)).toBe(false);
    expect(config).toEqual(before);
  });

  it('treats explicit enabled=true as user config', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: { enabled: true } } },
    };
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchDisabledDefault(config)).toBe(false);
    expect((config.agents as { defaults: { memorySearch: { enabled: boolean } } }).defaults.memorySearch.enabled).toBe(true);
  });

  it('treats an empty memorySearch object as user config', () => {
    const config: Record<string, unknown> = {
      agents: { defaults: { memorySearch: {} } },
    };
    expect(hasUserMemorySearchConfig(config)).toBe(true);
    expect(ensureMemorySearchDisabledDefault(config)).toBe(false);
  });
});
