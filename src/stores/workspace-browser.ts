import { create } from 'zustand';

export interface WorkspaceBrowserPreferences {
  expanded: string[];
  showHidden: boolean;
  treeWidth: number;
}
export const DEFAULT_WORKSPACE_BROWSER_PREFERENCES: WorkspaceBrowserPreferences = {
  expanded: [], showHidden: false, treeWidth: 220,
};

// UI-only preferences, scoped to agent + workspace and bounded in memory.
export const useWorkspaceBrowser = create<{
  scopes: Record<string, WorkspaceBrowserPreferences>;
  update: (scope: string, patch: Partial<WorkspaceBrowserPreferences>) => void;
}>((set) => ({
  scopes: {},
  update: (scope, patch) => set(state => {
    const scopes = { ...state.scopes, [scope]: { ...DEFAULT_WORKSPACE_BROWSER_PREFERENCES, ...state.scopes[scope], ...patch } };
    for (const old of Object.keys(scopes).slice(0, Math.max(0, Object.keys(scopes).length - 12))) delete scopes[old];
    return { scopes };
  }),
}));
