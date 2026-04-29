/**
 * Artifact panel state.
 *
 * Drives the right-side split panel on the Chat page: which tab is
 * active (变更 / 全部文件 / 浏览器 / 产物), whether a single file is
 * focused inside the changes tab, and the open/close state.
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

export type ArtifactTab = 'changes' | 'allFiles' | 'browser' | 'artifacts';

/** Width clamp (% of the chat container). */
export const ARTIFACT_PANEL_MIN_WIDTH = 28;
export const ARTIFACT_PANEL_MAX_WIDTH = 70;
export const ARTIFACT_PANEL_DEFAULT_WIDTH = 45;

interface ArtifactPanelState {
  open: boolean;
  tab: ArtifactTab;
  /**
   * When set inside the 变更 tab, the panel renders the file detail view
   * (source / preview / diff / info) instead of the file list.  Cleared
   * by the "← back" affordance.
   */
  focusedFile: FilePreviewTarget | null;
  /** Persisted panel width as a % of the chat container (clamped on read). */
  widthPct: number;
  setTab: (tab: ArtifactTab) => void;
  setFocusedFile: (file: FilePreviewTarget | null) => void;
  /** Open the changes tab. Optionally focus a single file. */
  openChanges: (file?: FilePreviewTarget | null) => void;
  /** Open the workspace browser tab. */
  openBrowser: () => void;
  /** Open the all-files tab. */
  openAllFiles: () => void;
  /** Open the artifacts tab. */
  openArtifacts: () => void;
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
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      setTab: (tab) => set({ tab, focusedFile: tab === 'changes' ? get().focusedFile : null }),
      setFocusedFile: (focusedFile) => set({ focusedFile }),
      openChanges: (file = null) => set({ open: true, tab: 'changes', focusedFile: file ?? null }),
      openBrowser: () => set({ open: true, tab: 'browser', focusedFile: null }),
      openAllFiles: () => set({ open: true, tab: 'allFiles', focusedFile: null }),
      openArtifacts: () => set({ open: true, tab: 'artifacts', focusedFile: null }),
      toggle: () => set((s) => ({ open: !s.open })),
      close: () => set({ open: false, focusedFile: null }),
      setWidthPct: (pct) => set({ widthPct: clampWidth(pct) }),
    }),
    {
      name: 'clawx.artifact-panel',
      // Only persist the user-controlled width — open/tab/focus reset on reload.
      partialize: (state) => ({ widthPct: state.widthPct }),
    },
  ),
);
