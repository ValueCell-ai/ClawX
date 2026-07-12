import { beforeEach, describe, expect, it } from 'vitest';
import { useArtifactPanel } from '@/stores/artifact-panel';

describe('artifact panel store', () => {
  beforeEach(() => {
    useArtifactPanel.setState({ open: false, tab: 'changes', focusedFile: null, focusedChange: null });
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
