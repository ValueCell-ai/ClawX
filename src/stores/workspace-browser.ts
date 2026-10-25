import { create } from 'zustand';

export type WorkspaceFileView = 'all' | 'task' | 'recent';
export interface WorkspaceBrowserPreferences {
  expanded: string[];
  recent: string[];
  showHidden: boolean;
  view: WorkspaceFileView;
  treeWidth: number;
}
export const DEFAULT_WORKSPACE_BROWSER_PREFERENCES: WorkspaceBrowserPreferences = {
  expanded: [], recent: [], showHidden: false, view: 'all', treeWidth: 220,
};

// UI-only metadata, scoped to agent + workspace. Never store file contents or
// persist file history across app restarts; bound both workspaces and recent rows.
export const useWorkspaceBrowser = create<{
  scopes: Record<string, WorkspaceBrowserPreferences>;
  update: (scope: string, patch: Partial<WorkspaceBrowserPreferences>) => void;
  remember: (scope: string, relativePath: string) => void;
}>((set) => ({
  scopes: {},
  update: (scope, patch) => set(state => {
    const scopes = { ...state.scopes, [scope]: { ...DEFAULT_WORKSPACE_BROWSER_PREFERENCES, ...state.scopes[scope], ...patch } };
    for (const old of Object.keys(scopes).slice(0, Math.max(0, Object.keys(scopes).length - 12))) delete scopes[old];
    return { scopes };
  }),
  remember: (scope, relativePath) => set(state => {
    const current = state.scopes[scope] ?? DEFAULT_WORKSPACE_BROWSER_PREFERENCES;
    const scopes = { ...state.scopes, [scope]: { ...current, recent: [relativePath, ...current.recent.filter(path => path !== relativePath)].slice(0, 20) } };
    for (const old of Object.keys(scopes).slice(0, Math.max(0, Object.keys(scopes).length - 12))) delete scopes[old];
    return { scopes };
  }),
}));
