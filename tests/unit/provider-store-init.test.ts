import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// Mock fetchProviderSnapshot before importing the store
const mockFetchProviderSnapshot = vi.fn();
vi.mock('@/lib/provider-accounts', () => ({
  fetchProviderSnapshot: (...args: unknown[]) => mockFetchProviderSnapshot(...args),
}));

// Mock hostApiFetch (used by other store methods)
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

// Import store after mocks are in place
import { useProviderStore } from '@/stores/providers';

describe('useProviderStore – init()', () => {
  beforeEach(() => {
    // Reset the store to initial state
    useProviderStore.setState({
      statuses: [],
      accounts: [],
      vendors: [],
      defaultAccountId: null,
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('init() calls refreshProviderSnapshot and populates state', async () => {
    const fakeSnapshot = {
      statuses: [{ id: 'anthropic', name: 'Anthropic', hasKey: true, keyMasked: 'sk-***' }],
      accounts: [{ id: 'acc-1', name: 'My Anthropic', type: 'anthropic' }],
      vendors: [{ id: 'anthropic', displayName: 'Anthropic' }],
      defaultAccountId: 'acc-1',
    };
    mockFetchProviderSnapshot.mockResolvedValueOnce(fakeSnapshot);

    await act(async () => {
      await useProviderStore.getState().init();
    });

    expect(mockFetchProviderSnapshot).toHaveBeenCalledOnce();

    const state = useProviderStore.getState();
    expect(state.statuses).toEqual(fakeSnapshot.statuses);
    expect(state.accounts).toEqual(fakeSnapshot.accounts);
    expect(state.vendors).toEqual(fakeSnapshot.vendors);
    expect(state.defaultAccountId).toBe('acc-1');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('init() sets error state when fetchProviderSnapshot fails', async () => {
    mockFetchProviderSnapshot.mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await useProviderStore.getState().init();
    });

    const state = useProviderStore.getState();
    expect(state.error).toBe('Error: Network error');
    expect(state.loading).toBe(false);
    expect(state.statuses).toEqual([]);
  });

  it('init() handles snapshot with missing fields gracefully', async () => {
    // Backend might return partial data
    mockFetchProviderSnapshot.mockResolvedValueOnce({
      statuses: null,
      accounts: undefined,
      vendors: [],
      defaultAccountId: undefined,
    });

    await act(async () => {
      await useProviderStore.getState().init();
    });

    const state = useProviderStore.getState();
    expect(state.statuses).toEqual([]);
    expect(state.accounts).toEqual([]);
    expect(state.vendors).toEqual([]);
    expect(state.defaultAccountId).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('calling init() multiple times re-fetches the snapshot each time', async () => {
    const snapshot1 = {
      statuses: [],
      accounts: [],
      vendors: [],
      defaultAccountId: null,
    };
    const snapshot2 = {
      statuses: [{ id: 'openai', name: 'OpenAI', hasKey: true, keyMasked: 'sk-***' }],
      accounts: [{ id: 'acc-2', name: 'My OpenAI', type: 'openai' }],
      vendors: [{ id: 'openai', displayName: 'OpenAI' }],
      defaultAccountId: 'acc-2',
    };
    mockFetchProviderSnapshot.mockResolvedValueOnce(snapshot1).mockResolvedValueOnce(snapshot2);

    await act(async () => {
      await useProviderStore.getState().init();
    });
    expect(useProviderStore.getState().statuses).toEqual([]);

    await act(async () => {
      await useProviderStore.getState().init();
    });
    expect(useProviderStore.getState().statuses).toEqual(snapshot2.statuses);
    expect(mockFetchProviderSnapshot).toHaveBeenCalledTimes(2);
  });
});
