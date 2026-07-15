import { describe, expect, it } from 'vitest';
import {
  OPENAI_CODEX_RUNTIME_PROVIDER_KEY,
  OPENCLAW_PROVIDER_KEY_ZAI,
  filterActiveProviderKeysForUi,
  getOpenClawProviderKeyForType,
  isOpenClawOAuthPluginProviderKey,
  isZaiProviderType,
  resolveOpenClawProviderKey,
} from '@electron/utils/provider-keys';

describe('provider-keys', () => {
  it('maps OpenAI browser OAuth accounts to the canonical openai runtime key', () => {
    expect(resolveOpenClawProviderKey({
      vendorId: 'openai',
      id: 'openai-personal',
      authMode: 'oauth_browser',
    })).toBe(OPENAI_CODEX_RUNTIME_PROVIDER_KEY);

    expect(resolveOpenClawProviderKey({
      vendorId: 'openai',
      id: 'openai-personal',
      authMode: 'api_key',
    })).toBe('openai');
  });

  it('aliases Z.AI Global UI vendor to the OpenClaw zai runtime key', () => {
    expect(getOpenClawProviderKeyForType('zai', 'zai-account')).toBe(OPENCLAW_PROVIDER_KEY_ZAI);
    expect(getOpenClawProviderKeyForType('zai-global', 'zai-global-account')).toBe(OPENCLAW_PROVIDER_KEY_ZAI);
    expect(isZaiProviderType('zai')).toBe(true);
    expect(isZaiProviderType('zai-global')).toBe(true);
    expect(isZaiProviderType('moonshot')).toBe(false);
  });

  it('keeps custom multi-instance hashing behavior', () => {
    expect(getOpenClawProviderKeyForType('custom', 'my-local')).toBe('custom-mylocal');
  });

  it('does not treat legacy openai-codex as an OAuth plugin provider key', () => {
    expect(isOpenClawOAuthPluginProviderKey('openai-codex')).toBe(false);
  });

  it('hides legacy openai-codex when canonical openai OAuth is active', () => {
    expect(filterActiveProviderKeysForUi(['openai', 'openai-codex', 'anthropic'])).toEqual([
      'openai',
      'anthropic',
    ]);
  });

  it('keeps openai in the UI list when an API key is configured alongside OAuth', () => {
    expect(filterActiveProviderKeysForUi(['openai', 'openai-codex'], {
      hasConfiguredOpenAiApiKey: true,
    })).toEqual(['openai', 'openai-codex']);
  });

  it('keeps bare openai visible when no legacy openai-codex slot remains', () => {
    expect(filterActiveProviderKeysForUi(['openai', 'minimax-portal'])).toEqual(['openai', 'minimax-portal']);
  });
});
