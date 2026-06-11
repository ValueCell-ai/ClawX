import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

export function createRuntimeUiActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'refresh' | 'clearError'> {
  return {
    // ── Refresh: reload history + sessions ──

    refresh: async () => {
      const { loadHistory, loadSessions } = get();
      await Promise.all([loadHistory(), loadSessions()]);
    },

    clearError: () => {
      const { runError, currentSessionKey, dismissedRunErrors } = get();
      set({
        error: null,
        runError: null,
        ...(runError
          ? { dismissedRunErrors: { ...dismissedRunErrors, [currentSessionKey]: runError } }
          : {}),
      });
    },
  };
}
