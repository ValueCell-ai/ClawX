import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_PANEL_DEFAULT_WIDTH,
  type ArtifactTab,
  useArtifactPanel,
} from '@/stores/artifact-panel';

describe('artifact panel store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useArtifactPanel.setState({
      open: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      webBrowserInitialized: false,
      webBrowserAnchor: null,
      webBrowserNavigation: null,
      webBrowserNavigationId: 0,
    });
  });

  it('keeps Workspace and Web Browser as distinct tabs', () => {
    const tabs: ArtifactTab[] = ['browser', 'web-browser'];

    useArtifactPanel.getState().setTab(tabs[0]);
    expect(useArtifactPanel.getState().tab).toBe('browser');

    useArtifactPanel.getState().setTab(tabs[1]);
    expect(useArtifactPanel.getState().tab).toBe('web-browser');
  });

  it('initializes Web Browser once and never resets it on tab changes or close', () => {
    expect(useArtifactPanel.getState().webBrowserInitialized).toBe(false);

    useArtifactPanel.getState().setTab('web-browser');
    expect(useArtifactPanel.getState().webBrowserInitialized).toBe(true);

    useArtifactPanel.getState().setTab('changes');
    useArtifactPanel.getState().close();
    expect(useArtifactPanel.getState().webBrowserInitialized).toBe(true);
  });

  it('opens, selects, and initializes Web Browser', () => {
    useArtifactPanel.getState().openWebBrowser();

    expect(useArtifactPanel.getState()).toMatchObject({
      open: true,
      tab: 'web-browser',
      webBrowserInitialized: true,
    });
  });

  it('records a fresh browser navigation when opening a URL', () => {
    useArtifactPanel.getState().openWebBrowser('file:///workspace/site.html');
    const first = useArtifactPanel.getState().webBrowserNavigation;
    useArtifactPanel.getState().openWebBrowser('file:///workspace/site.html');
    const second = useArtifactPanel.getState().webBrowserNavigation;

    expect(first).toMatchObject({ id: 1, url: 'file:///workspace/site.html' });
    expect(second).toMatchObject({ id: 2, url: 'file:///workspace/site.html' });
  });

  it('registers and clears the anchor without changing initialization', () => {
    const anchor = document.createElement('div');

    useArtifactPanel.getState().setWebBrowserAnchor(anchor);
    expect(useArtifactPanel.getState()).toMatchObject({
      webBrowserAnchor: anchor,
      webBrowserInitialized: false,
    });

    useArtifactPanel.getState().setTab('web-browser');
    useArtifactPanel.getState().setWebBrowserAnchor(null);
    expect(useArtifactPanel.getState()).toMatchObject({
      webBrowserAnchor: null,
      webBrowserInitialized: true,
    });
  });

  it('persists only the panel width', () => {
    useArtifactPanel.getState().setWidthPct(52);
    useArtifactPanel.getState().openWebBrowser();
    useArtifactPanel.getState().setWebBrowserAnchor(document.createElement('div'));

    expect(JSON.parse(window.localStorage.getItem('clawx.artifact-panel') ?? '{}')).toEqual({
      state: { widthPct: 52 },
      version: 0,
    });
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
