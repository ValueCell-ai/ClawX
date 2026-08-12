import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { WebBrowserHost } from '@/components/web-browser/WebBrowserHost';
import { useArtifactPanel } from '@/stores/artifact-panel';

const { navigate, toastError } = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  toastError: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { webBrowser: { navigate } },
}));

vi.mock('sonner', () => ({ toast: { error: toastError } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

interface MockWebview extends HTMLElement {
  isLoading: ReturnType<typeof vi.fn>;
}

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this);
  }
  unobserve() {}
  disconnect() {}
}

function htmlFile() {
  return {
    filePath: '/workspace/site one.html',
    fileName: 'site one.html',
    ext: '.html',
    mimeType: 'text/html',
    contentType: 'document' as const,
    workspaceFileRef: {
      workspaceRoot: '/workspace',
      relativePath: 'site one.html',
    },
  };
}

function makeAnchor(parent: HTMLElement = document.body) {
  const anchor = document.createElement('div');
  anchor.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    width: 640,
    height: 480,
    right: 650,
    bottom: 500,
    toJSON: () => ({}),
  } as DOMRect);
  parent.append(anchor);
  return anchor;
}

function webview(): MockWebview {
  return screen.getByTestId('html-preview-webview') as MockWebview;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    const element = Document.prototype.createElement.call(document, tagName, options);
    if (tagName.toLowerCase() === 'webview') {
      Object.assign(element, { isLoading: vi.fn(() => false) });
    }
    return element;
  });
  useArtifactPanel.setState({
    open: false,
    tab: 'changes',
    focusedFile: null,
    htmlPreviewAnchor: null,
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HTML preview host', () => {
  it('does not create a guest for non-HTML files', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: { ...htmlFile(), fileName: 'notes.md', filePath: '/workspace/notes.md', ext: '.md' },
      htmlPreviewAnchor: makeAnchor(),
    });

    render(<WebBrowserHost />);

    expect(screen.queryByTestId('html-preview-host')).not.toBeInTheDocument();
  });

  it('creates a chrome-free guest and loads only the selected local HTML through Host API', async () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: htmlFile(),
      htmlPreviewAnchor: makeAnchor(),
    });
    render(<WebBrowserHost />);

    const guest = webview();
    expect(guest).toHaveAttribute('src', WEB_BROWSER_INITIAL_URL);
    expect(guest).toHaveAttribute('partition', WEB_BROWSER_PARTITION);
    expect(guest).toHaveAttribute('useragent', WEB_BROWSER_USER_AGENT);
    expect(guest).not.toHaveAttribute('allowpopups');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent(guest, new Event('did-attach'));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('file:///workspace/site%20one.html');
    });
  });

  it('loads the selected local HTML when the guest becomes DOM-ready', async () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: htmlFile(),
      htmlPreviewAnchor: makeAnchor(),
    });
    render(<WebBrowserHost />);

    fireEvent(webview(), new Event('dom-ready'));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('file:///workspace/site%20one.html');
    });
  });

  it('keeps the guest mounted but inert when Preview is hidden', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: htmlFile(),
      htmlPreviewAnchor: makeAnchor(),
    });
    render(<WebBrowserHost />);

    const guest = webview();
    act(() => useArtifactPanel.getState().setTab('changes'));

    expect(webview()).toBe(guest);
    expect(screen.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'true');
  });

  it('raises the guest above the fullscreen preview layer', () => {
    const fullscreenLayer = document.createElement('div');
    fullscreenLayer.dataset.testid = 'file-preview-fullscreen-layer';
    document.body.append(fullscreenLayer);
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: htmlFile(),
      htmlPreviewAnchor: makeAnchor(fullscreenLayer),
    });

    render(<WebBrowserHost />);

    expect(screen.getByTestId('html-preview-host')).toHaveStyle({ zIndex: '110' });
  });

  it('recreates a crashed guest without adding browser controls', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: htmlFile(),
      htmlPreviewAnchor: makeAnchor(),
    });
    render(<WebBrowserHost />);

    const failedGuest = webview();
    fireEvent(failedGuest, new Event('render-process-gone'));
    expect(screen.getByRole('alert')).toHaveTextContent('HTML preview stopped');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(webview()).not.toBe(failedGuest);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
