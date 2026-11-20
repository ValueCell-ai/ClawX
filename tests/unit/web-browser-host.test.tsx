import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { WebBrowserHost } from '@/components/web-browser/WebBrowserHost';
import { useHtmlPreview } from '@/stores/html-preview';
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
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    const element = Document.prototype.createElement.call(document, tagName, options);
    if (tagName.toLowerCase() === 'webview') {
      Object.assign(element, { isLoading: vi.fn(() => false) });
    }
    return element;
  });
  useHtmlPreview.setState({ bindings: [], current: null });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HTML preview host', () => {
  it('does not create a guest for non-HTML files', () => {
    useHtmlPreview.getState().register({ owner: Symbol(), file: { ...htmlFile(), fileName: 'notes.md', filePath: '/workspace/notes.md', ext: '.md' }, anchor: makeAnchor(), active: true });

    render(<WebBrowserHost />);

    expect(screen.queryByTestId('html-preview-host')).not.toBeInTheDocument();
  });

  it('creates a chrome-free guest and loads only the selected local HTML through Host API', async () => {
    useHtmlPreview.getState().register({ owner: Symbol(), file: htmlFile(), anchor: makeAnchor(), active: true });
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
    useHtmlPreview.getState().register({ owner: Symbol(), file: htmlFile(), anchor: makeAnchor(), active: true });
    render(<WebBrowserHost />);

    fireEvent(webview(), new Event('dom-ready'));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('file:///workspace/site%20one.html');
    });
  });

  it('keeps the guest mounted but inert when Preview is hidden', () => {
    useHtmlPreview.getState().register({ owner: Symbol(), file: htmlFile(), anchor: makeAnchor(), active: true });
    render(<WebBrowserHost />);

    const guest = webview();
    const binding = useHtmlPreview.getState().current!;
    act(() => useHtmlPreview.getState().register({ ...binding, active: false }));

    expect(webview()).toBe(guest);
    expect(screen.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the same guest for a workspace HTML selection inside the narrow drawer', () => {
    const drawer = document.createElement('div');
    drawer.setAttribute('role', 'dialog');
    document.body.append(drawer);
    const anchor = makeAnchor();
    drawer.append(anchor);
    useHtmlPreview.getState().register({ owner: Symbol(), file: htmlFile(), anchor, active: true });
    render(<WebBrowserHost />);
    expect(screen.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'false');
    expect(drawer).toContainElement(screen.getByTestId('html-preview-host'));
    expect(anchor).toContainElement(webview());
    drawer.remove();
  });

  it('recreates a crashed guest without adding browser controls', () => {
    useHtmlPreview.getState().register({ owner: Symbol(), file: htmlFile(), anchor: makeAnchor(), active: true });
    render(<WebBrowserHost />);

    const failedGuest = webview();
    fireEvent(failedGuest, new Event('render-process-gone'));
    expect(screen.getByRole('alert')).toHaveTextContent('HTML preview stopped');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(webview()).not.toBe(failedGuest);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('gives a dialog reader ownership without changing conversation selection, then restores the underlying reader', () => {
    const workspaceOwner = Symbol('workspace');
    const skillOwner = Symbol('skill');
    const workspaceAnchor = makeAnchor();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    const skillAnchor = makeAnchor(dialog);
    const conversationFile = htmlFile();
    useArtifactPanel.setState({ focusedFile: conversationFile });
    useHtmlPreview.getState().register({ owner: workspaceOwner, file: conversationFile, anchor: workspaceAnchor, active: true });
    render(<WebBrowserHost />);
    act(() => useHtmlPreview.getState().register({ owner: skillOwner, file: { ...htmlFile(), filePath: '/skills/demo.html' }, anchor: skillAnchor, active: true }));
    expect(skillAnchor).toContainElement(webview());
    expect(screen.getAllByTestId('html-preview-webview')).toHaveLength(1);
    expect(useArtifactPanel.getState().focusedFile).toBe(conversationFile);
    act(() => useHtmlPreview.getState().unregister(Symbol('stale')));
    expect(skillAnchor).toContainElement(webview());
    act(() => useHtmlPreview.getState().unregister(skillOwner));
    expect(workspaceAnchor).toContainElement(webview());
    act(() => useHtmlPreview.getState().unregister(workspaceOwner));
    expect(screen.queryByTestId('html-preview-host')).not.toBeInTheDocument();
  });

});
