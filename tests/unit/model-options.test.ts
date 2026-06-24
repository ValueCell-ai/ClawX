import { describe, expect, it } from 'vitest';
import {
  buildConfiguredModelOptions,
  formatConfiguredModelLabel,
  formatModelRefLabel,
  formatProviderDisplayName,
  isConfiguredModelRefAvailable,
  resolveConfiguredModelRef,
  resolveRuntimeProviderKey,
} from '../../src/lib/model-options';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '../../src/lib/providers';

const now = '2026-04-28T00:00:00.000Z';

function account(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: 'custom-alpha1234',
    vendorId: 'custom',
    label: 'Alpha',
    authMode: 'api_key',
    model: 'model-alpha',
    enabled: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ProviderAccount;
}

function status(id: string, hasKey = true): ProviderWithKeyInfo {
  return {
    id,
    type: 'custom',
    name: id,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    hasKey,
    keyMasked: hasKey ? 'sk-***' : null,
  } as ProviderWithKeyInfo;
}

const vendors: ProviderVendorInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    category: 'official',
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
];

describe('model option helpers', () => {
  it('formats model refs using only the text after the provider prefix', () => {
    expect(formatModelRefLabel('openrouter/openai/gpt-5.5')).toBe('openai/gpt-5.5');
    expect(formatModelRefLabel('custom-alpha1234/model-alpha')).toBe('model-alpha');
  });

  it('formats provider display names using custom labels or vendor names', () => {
    const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
    expect(formatProviderDisplayName(account({ vendorId: 'custom', label: 'Alpha' }), vendorMap)).toBe('Alpha');
    expect(formatProviderDisplayName(account({ vendorId: 'openai', label: 'OpenAI' }), vendorMap)).toBe('OpenAI');
    expect(formatConfiguredModelLabel('gpt-5.5', account({ vendorId: 'openai', label: 'OpenAI' }), vendorMap)).toBe('gpt-5.5 (OpenAI)');
  });

  it('builds one configured custom model option per account', () => {
    const options = buildConfiguredModelOptions(
      [
        account({ id: 'alpha1234', model: 'model-alpha', updatedAt: '2026-04-03T00:00:00.000Z' }),
        account({ id: 'beta5678', label: 'Beta', model: 'provider/model-beta', updatedAt: '2026-04-02T00:00:00.000Z' }),
      ],
      [status('alpha1234'), status('beta5678')],
      vendors,
      'alpha1234',
    );

    expect(options).toEqual([
      {
        modelRef: 'custom-alpha123/model-alpha',
        label: 'model-alpha (Alpha)',
        runtimeProviderKey: 'custom-alpha123',
        accountId: 'alpha1234',
      },
      {
        modelRef: 'custom-beta5678/provider/model-beta',
        label: 'provider/model-beta (Beta)',
        runtimeProviderKey: 'custom-beta5678',
        accountId: 'beta5678',
      },
    ]);
  });

  it('keeps prefixed account models intact and skips accounts without credentials', () => {
    const runtimeKey = resolveRuntimeProviderKey(account({ id: 'gamma9012' }));
    const options = buildConfiguredModelOptions(
      [
        account({ id: 'gamma9012', model: `${runtimeKey}/model-gamma` }),
        account({ id: 'delta3456', label: 'Delta', model: 'model-delta' }),
      ],
      [status('gamma9012'), status('delta3456', false)],
      vendors,
      null,
    );

    expect(options).toHaveLength(1);
    expect(options[0].modelRef).toBe('custom-gamma901/model-gamma');
    expect(options[0].label).toBe('model-gamma (Alpha)');
  });

  it('builds multiple configured model options from account metadata custom models', () => {
    const accountId = 'model-hub-01';
    const runtimeKey = resolveRuntimeProviderKey(account({ id: accountId, label: 'Model Hub' }));
    const options = buildConfiguredModelOptions(
      [
        account({
          id: accountId,
          label: 'Model Hub',
          model: 'model-default',
          metadata: { customModels: ['gpt-5.4', 'claude-sonnet-4', 'gpt-5.4'] },
        }),
      ],
      [status(accountId)],
      vendors,
      accountId,
    );

    expect(options).toEqual([
      {
        modelRef: `${runtimeKey}/gpt-5.4`,
        label: 'gpt-5.4 (Model Hub)',
        runtimeProviderKey: runtimeKey,
        accountId,
      },
      {
        modelRef: `${runtimeKey}/claude-sonnet-4`,
        label: 'claude-sonnet-4 (Model Hub)',
        runtimeProviderKey: runtimeKey,
        accountId,
      },
    ]);
  });

  it('preserves custom runtime keys that are already normalized', () => {
    const runtimeKey = resolveRuntimeProviderKey(account({
      id: 'custom-enterpri',
      label: 'Enterprise',
      model: 'custom-enterpri/gpt-5.4',
      metadata: { customModels: ['gpt-5.4', 'gpt-5.5'] },
    }));

    const options = buildConfiguredModelOptions(
      [
        account({
          id: 'custom-enterpri',
          label: 'Enterprise',
          model: 'custom-enterpri/gpt-5.4',
          metadata: { customModels: ['gpt-5.4', 'gpt-5.5'] },
        }),
      ],
      [status('custom-enterpri')],
      vendors,
      'custom-enterpri',
    );

    expect(runtimeKey).toBe('custom-enterpri');
    expect(options).toEqual([
      {
        modelRef: 'custom-enterpri/gpt-5.4',
        label: 'gpt-5.4 (Enterprise)',
        runtimeProviderKey: 'custom-enterpri',
        accountId: 'custom-enterpri',
      },
      {
        modelRef: 'custom-enterpri/gpt-5.5',
        label: 'gpt-5.5 (Enterprise)',
        runtimeProviderKey: 'custom-enterpri',
        accountId: 'custom-enterpri',
      },
    ]);
  });

  it('treats malformed provider snapshots as empty options', () => {
    expect(
      buildConfiguredModelOptions(
        {} as ProviderAccount[],
        {} as ProviderWithKeyInfo[],
        {} as ProviderVendorInfo[],
        null,
      ),
    ).toEqual([]);
  });

  it('falls back to default or first configured model when preferred ref is stale', () => {
    const options = buildConfiguredModelOptions(
      [account({ id: 'alpha1234', model: 'model-alpha' })],
      [status('alpha1234')],
      vendors,
      'alpha1234',
    );

    expect(resolveConfiguredModelRef('custom-deleted/gpt-5.5', 'custom-alpha123/model-alpha', options))
      .toBe('custom-alpha123/model-alpha');
    expect(resolveConfiguredModelRef('custom-deleted/gpt-5.5', null, options))
      .toBe('custom-alpha123/model-alpha');
    expect(isConfiguredModelRefAvailable('custom-deleted/gpt-5.5', options)).toBe(false);
  });
});
