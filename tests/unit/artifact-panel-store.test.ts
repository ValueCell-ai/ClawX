import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_PANEL_DEFAULT_WIDTH,
  type ArtifactTab,
  useArtifactPanel,
} from '@/stores/artifact-panel';

describe('artifact panel store', () => {
  beforeEach(() => {
    useArtifactPanel.setState({
      open: false,
      maximized: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });
  });

  it('keeps Workspace, Preview, and Changes as the only tabs', () => {
    const tabs: ArtifactTab[] = ['browser', 'preview', 'changes'];

    for (const tab of tabs) {
      useArtifactPanel.getState().setTab(tab);
      expect(useArtifactPanel.getState().tab).toBe(tab);
    }
  });

  it('restores the current split and starts at the default size when reopened', () => {
    useArtifactPanel.getState().openBrowser();
    useArtifactPanel.getState().setWidthPct(52);
    useArtifactPanel.getState().toggleMaximized();
    useArtifactPanel.getState().openPreview();
    expect(useArtifactPanel.getState()).toMatchObject({ maximized: true, widthPct: 52 });
    useArtifactPanel.getState().toggleMaximized();
    expect(useArtifactPanel.getState()).toMatchObject({ maximized: false, widthPct: 52 });
    useArtifactPanel.getState().toggleMaximized();
    useArtifactPanel.getState().close();
    useArtifactPanel.getState().openBrowser();
    expect(useArtifactPanel.getState()).toMatchObject({ maximized: false, widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH });
  });

  it('keeps preview and change focus separate and clears both on close', () => {
    const file = {
      filePath: 'report.pdf',
      fileName: 'report.pdf',
      ext: '.pdf',
      mimeType: 'application/pdf',
      contentType: 'document' as const,
    };
    useArtifactPanel.getState().openPreview(file);
    useArtifactPanel.getState().openChanges({ relativePath: 'report.pdf', turnId: 'turn-1' });

    expect(useArtifactPanel.getState().focusedFile).toEqual(file);
    expect(useArtifactPanel.getState().focusedChange).toMatchObject({
      relativePath: 'report.pdf',
      turnId: 'turn-1',
      navigationId: expect.any(Number),
    });

    useArtifactPanel.getState().close();
    expect(useArtifactPanel.getState()).toMatchObject({ open: false, focusedFile: null, focusedChange: null });
  });

  it('materializes a fresh monotonic navigation for repeated calls with the same focus object', () => {
    const focus = { relativePath: 'src/app.ts', turnId: 'turn-1' };

    useArtifactPanel.getState().openChanges(focus);
    const first = useArtifactPanel.getState().focusedChange as { navigationId: number };
    useArtifactPanel.getState().openChanges(focus);
    const second = useArtifactPanel.getState().focusedChange as { navigationId: number };

    expect(second).not.toBe(first);
    expect(second.navigationId).toBeGreaterThan(first.navigationId);
  });
});
