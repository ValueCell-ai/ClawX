import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserLink } from '@/components/common/BrowserLink';
import { localHtmlBrowserUrl } from '@/lib/local-html-browser';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { ARTIFACT_PANEL_DEFAULT_WIDTH } from '@/stores/artifact-panel';

const openExternalUrl = vi.fn(async () => undefined);

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    webBrowser: {
      openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'artifactPanel.webBrowser.linkMenu.openInClawX': 'Open in ClawX',
      'artifactPanel.webBrowser.linkMenu.openInSystemBrowser': 'Open in system browser',
    })[key] ?? key,
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
  act(() => {
    useArtifactPanel.setState({
      open: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      webBrowserInitialized: false,
      webBrowserAnchor: null,
      webBrowserNavigation: null,
    });
  });
});

describe('BrowserLink', () => {
  it('opens HTTP links externally on ordinary activation', () => {
    render(<BrowserLink href="HTTPS://Example.COM/a path">Example</BrowserLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Example' }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a%20path');
    expect(useArtifactPanel.getState().webBrowserInitialized).toBe(false);
  });

  it('offers explicit internal and external actions on right click', async () => {
    const { rerender } = render(<BrowserLink href="https://example.com/internal">Example</BrowserLink>);
    const link = screen.getByRole('link', { name: 'Example' });

    fireEvent.contextMenu(link);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in ClawX' }));

    expect(useArtifactPanel.getState()).toMatchObject({
      open: true,
      tab: 'web-browser',
      webBrowserInitialized: true,
      webBrowserNavigation: { url: 'https://example.com/internal' },
    });
    expect(openExternalUrl).not.toHaveBeenCalled();

    rerender(<BrowserLink href="https://example.com/external">Example</BrowserLink>);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Example' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in system browser' }));

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/external');
    });
  });

  it('does not expose browser actions for unsupported schemes', () => {
    render(<BrowserLink href="mailto:test@example.com">Email</BrowserLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Email' }));
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Email' }));

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('localHtmlBrowserUrl', () => {
  it('builds encoded file URLs only for HTML workspace targets', () => {
    const target = {
      kind: 'workspace' as const,
      ref: { workspaceRoot: '/workspace/demo', relativePath: 'site/report #1.html' },
    };

    expect(localHtmlBrowserUrl(target, 'site/report #1.html')).toBe(
      'file:///workspace/demo/site/report%20%231.html',
    );
    expect(localHtmlBrowserUrl(target, 'site/report.md')).toBeNull();
  });

  it('accepts local attachment paths but rejects remote HTML attachments', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: '/workspace/site one.htm' };

    expect(localHtmlBrowserUrl({ kind: 'attachment', ref }, 'site one.htm')).toBe(
      'file:///workspace/site%20one.htm',
    );
    expect(localHtmlBrowserUrl({
      kind: 'attachment',
      ref: { ...ref, uri: 'https://example.com/site.htm' },
    }, 'site.htm')).toBeNull();
  });
});
