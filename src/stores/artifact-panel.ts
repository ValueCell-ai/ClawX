/**
 * Artifact panel state.
 *
 * Drives the right-side split panel on the Chat page: which tab is
 * active (变更 / 预览 / 工作空间), independent preview/change focus, and
 * the open/close state.
 *
 * The actual content (file lists, workspace tree, etc.) is provided by
 * the chat page as props — we only track UI state here so the panel can
 * be opened/closed/focused from anywhere (file cards, toolbar buttons,
 * "查看文件变更 →" links, …).
 *
 * `widthPct` is persisted via `zustand/middleware`'s `persist` so the
 * user's preferred split survives reloads.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FilePreviewTarget } from '@/components/file-preview/types';

export type ArtifactTab = 'changes' | 'preview' | 'browser';

export type ArtifactChangeFocus = {
  relativePath: string;
  turnId?: string;
  activitySequence?: number;
};

export type ArtifactChangeNavigation = ArtifactChangeFocus & {
  navigationId: number;
};

/** Width clamp (% of the chat container). */
export const ARTIFACT_PANEL_MIN_WIDTH = 28;
export const ARTIFACT_PANEL_MAX_WIDTH = 70;
export const ARTIFACT_PANEL_DEFAULT_WIDTH = 45;

interface ArtifactPanelState {
  open: boolean;
  tab: ArtifactTab;
  /**
   * The currently selected Preview file. Changes navigation is tracked
   * separately in `focusedChange`.
   */
  focusedFile: FilePreviewTarget | null;
  focusedChange: ArtifactChangeNavigation | null;
  changeNavigationId: number;
  /** Persisted panel width as a % of the chat container (clamped on read). */
  widthPct: number;
  setTab: (tab: ArtifactTab) => void;
  setFocusedFile: (file: FilePreviewTarget | null) => void;
  /** Open the changes tab. Optionally focus a projected change. */
  openChanges: (focus?: ArtifactChangeFocus | null) => void;
  /** Open the preview tab on a specific file. */
  openPreview: (file?: FilePreviewTarget | null) => void;
  /** Open the workspace browser tab. */
  openBrowser: () => void;
  toggle: () => void;
  close: () => void;
  /** Update the panel width (clamped). */
  setWidthPct: (pct: number) => void;
}

function clampWidth(pct: number): number {
  if (!Number.isFinite(pct)) return ARTIFACT_PANEL_DEFAULT_WIDTH;
  if (pct < ARTIFACT_PANEL_MIN_WIDTH) return ARTIFACT_PANEL_MIN_WIDTH;
  if (pct > ARTIFACT_PANEL_MAX_WIDTH) return ARTIFACT_PANEL_MAX_WIDTH;
  return pct;
}

export const useArtifactPanel = create<ArtifactPanelState>()(
  persist(
    (set, get) => ({
      open: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      changeNavigationId: 0,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      setTab: (tab) => {
        // The browser tab has its own internal workspace-tree selection, so
        // keep the chat-side focused file available for preview/changes.
        set({ tab, focusedFile: get().focusedFile });
      },
      setFocusedFile: (focusedFile) => set({ focusedFile }),
      openChanges: (focus = null) => set((state) => {
        const navigationId = state.changeNavigationId + 1;
        return {
          open: true,
          tab: 'changes',
          focusedChange: focus ? { ...focus, navigationId } : null,
          changeNavigationId: navigationId,
        };
      }),
      openPreview: (file = null) => set({ open: true, tab: 'preview', focusedFile: file ?? null }),
      openBrowser: () => set({ open: true, tab: 'browser', focusedFile: get().focusedFile }),
      toggle: () => set((s) => ({ open: !s.open })),
      close: () => set({ open: false, focusedFile: null, focusedChange: null }),
      setWidthPct: (pct) => set({ widthPct: clampWidth(pct) }),
    }),
    {
      name: 'clawx.artifact-panel',
      // Only persist the user-controlled width — open/tab/focus reset on reload.
      partialize: (state) => ({ widthPct: state.widthPct }),
    },
  ),
);
