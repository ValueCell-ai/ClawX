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
 * Split width and maximized state are scoped to the open panel.
 */
import { create } from 'zustand';
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

const defaultPanelSize = {
  maximized: false,
  widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
};

interface ArtifactPanelState {
  open: boolean;
  maximized: boolean;
  tab: ArtifactTab;
  /**
   * The currently selected Preview file. Changes navigation is tracked
   * separately in `focusedChange`.
   */
  focusedFile: FilePreviewTarget | null;
  focusedChange: ArtifactChangeNavigation | null;
  changeNavigationId: number;
  /** Split width as a percentage of the chat container. */
  widthPct: number;
  previewSlidePositions: Record<string, number>;
  rememberPreviewSlide: (identity: string, index: number) => void;
  setTab: (tab: ArtifactTab) => void;
  setFocusedFile: (file: FilePreviewTarget | null) => void;
  /** Open the changes tab. Optionally focus a projected change. */
  openChanges: (focus?: ArtifactChangeFocus | null) => void;
  /** Open the preview tab on a specific file. */
  openPreview: (file?: FilePreviewTarget | null) => void;
  /** Open the workspace browser tab. */
  openBrowser: () => void;
  toggle: () => void;
  toggleMaximized: () => void;
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

export const useArtifactPanel = create<ArtifactPanelState>()((set, get) => ({
  open: false,
  tab: 'changes',
  focusedFile: null,
  focusedChange: null,
  changeNavigationId: 0,
  ...defaultPanelSize,
  previewSlidePositions: {},
  rememberPreviewSlide: (identity, index) => set(state => {
    const entries = Object.entries({ ...state.previewSlidePositions, [identity]: index }).slice(-32);
    return { previewSlidePositions: Object.fromEntries(entries) };
  }),
  setTab: (tab) => {
    // Workspace navigation and Preview share the same focused file;
    // change-record navigation remains independent.
    set({
      tab,
      focusedFile: get().focusedFile,
    });
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
  toggle: () => set(state => ({ open: !state.open, ...defaultPanelSize })),
  toggleMaximized: () => set(state => state.open ? { maximized: !state.maximized } : state),
  close: () => set({ open: false, ...defaultPanelSize, focusedFile: null, focusedChange: null, previewSlidePositions: {} }),
  setWidthPct: (pct) => set({ widthPct: clampWidth(pct) }),
}));
