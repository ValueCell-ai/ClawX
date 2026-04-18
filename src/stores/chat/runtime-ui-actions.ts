import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

export function createRuntimeUiActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'refresh' | 'clearError'> {
  return {
    // ── Refresh: reload history + sessions ──

    refresh: async () => {
      const { loadHistory, loadSessions } = get();
      await Promise.all([loadHistory(), loadSessions()]);
    },

    clearError: () => set({ error: null }),
  };
}
