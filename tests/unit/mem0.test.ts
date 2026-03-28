import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEM0_SETTINGS,
  buildMem0Envelope,
  normalizeMem0Settings,
  resolveMem0RootSessionKey,
  stripMem0Envelope,
} from '../../shared/mem0';

describe('mem0 helpers', () => {
  it('normalizes settings with trimmed base URL and bounded numbers', () => {
    expect(normalizeMem0Settings({
      enabled: true,
      apiBaseUrl: ' https://api.mem0.ai/// ',
      topK: 99,
      historyWindowMessages: 1,
      compactionTriggerMessages: 3,
      compactionMaxLines: 999,
    })).toEqual({
      enabled: true,
      apiBaseUrl: 'https://api.mem0.ai',
      topK: 20,
      historyWindowMessages: 2,
      compactionTriggerMessages: 6,
      compactionMaxLines: 400,
    });
  });

  it('falls back to defaults when settings are missing or invalid', () => {
    expect(normalizeMem0Settings({
      enabled: false,
      apiBaseUrl: '   ',
      topK: Number.NaN,
    })).toEqual(DEFAULT_MEM0_SETTINGS);
  });

  it('wraps recalled memories in a hidden envelope and strips it back out', () => {
    const envelope = buildMem0Envelope([
      '  user likes terse answers  ',
      'project codename is Atlas',
    ]);

    expect(envelope).toContain('[clawx-mem0-context:v1]');
    expect(envelope).toContain('- user likes terse answers');
    expect(envelope).toContain('- project codename is Atlas');

    const visibleText = stripMem0Envelope(`${envelope}\n\nWhat changed since yesterday?`);
    expect(visibleText).toBe('What changed since yesterday?');
  });

  it('prefers the shared root session key when provided', () => {
    expect(resolveMem0RootSessionKey('agent:research:desk', {
      rootSessionKey: '  agent:main:main  ',
    })).toBe('agent:main:main');
    expect(resolveMem0RootSessionKey('agent:research:desk')).toBe('agent:research:desk');
  });
});
