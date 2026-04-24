import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@electron/shared/providers/types';

const state: Record<string, unknown> = {};

vi.mock('@electron/services/providers/store-instance', () => ({
  getClawXProviderStore: vi.fn(async () => ({
    get: (key: string) => state[key],
    set: (key: string, value: unknown) => {
      state[key] = value;
    },
  })),
}));

import {
  listProviderProfileStates,
  markProviderProfileFailure,
  markProviderProfileSuccess,
} from '@electron/services/providers/provider-profile-lifecycle';

const account = (id: string, priority: number): ProviderAccount => ({
  id,
  vendorId: 'openai',
  label: id,
  priority,
  authMode: 'api_key',
  enabled: true,
  isDefault: false,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
});

describe('provider-profile-lifecycle', () => {
  beforeEach(() => {
    for (const key of Object.keys(state)) {
      delete state[key];
    }
  });

  it('initializes and sorts profile states by priority', async () => {
    const states = await listProviderProfileStates([account('a', 20), account('b', 10)]);
    expect(states.map((item) => item.accountId)).toEqual(['b', 'a']);
    expect(states.every((item) => item.status === 'active')).toBe(true);
  });

  it('marks failures and restores active state on success', async () => {
    await listProviderProfileStates([account('a', 10)]);
    const failed = await markProviderProfileFailure('a', 'rate limit exceeded');
    expect(failed?.status).toBe('cooldown');
    expect(failed?.failureCount).toBe(1);

    const recovered = await markProviderProfileSuccess('a');
    expect(recovered?.status).toBe('active');
    expect(recovered?.cooldownUntil).toBeUndefined();
  });
});
