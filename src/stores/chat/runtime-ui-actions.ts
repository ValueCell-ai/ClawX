import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

export function createRuntimeUiActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'toggleThinking' | 'refresh' | 'clearError'> {
  return {
    toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

    // ── Refresh: reload history + sessions ──

    refresh: async () => {
      const { loadHistory, loadSessions } = get();
      await Promise.all([loadHistory(), loadSessions()]);
    },

    clearError: () => set({ error: null }),
  };
}
