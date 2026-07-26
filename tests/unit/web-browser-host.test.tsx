import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WebBrowserHost } from '@/components/web-browser/WebBrowserHost';
import { useArtifactPanel } from '@/stores/artifact-panel';

const hostApiMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  clearCookies: vi.fn(),
  clearSiteData: vi.fn(),
  openExternal: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: { webBrowser: hostApiMocks },
}));

vi.mock('sonner', () => ({ toast: toastMocks }));

const translations: Record<string, string> = {
  'artifactPanel.webBrowser.actions.back': 'Back',
  'artifactPanel.webBrowser.actions.forward': 'Forward',
  'artifactPanel.webBrowser.actions.refresh': 'Refresh',
  'artifactPanel.webBrowser.actions.more': 'More',
  'artifactPanel.webBrowser.actions.forceRefresh': 'Force Refresh',
  'artifactPanel.webBrowser.actions.clearCookies': 'Clear Cookies',
  'artifactPanel.webBrowser.actions.clearSiteData': 'Clear Site Data',
  'artifactPanel.webBrowser.actions.openExternal': 'Open in System Browser',
  'artifactPanel.webBrowser.address.label': 'Web address',
  'artifactPanel.webBrowser.address.placeholder': 'Enter a URL',
  'artifactPanel.webBrowser.errors.empty': 'Enter a web address.',
  'artifactPanel.webBrowser.errors.absolutePath': 'Local paths must use a file:/// URL.',
  'artifactPanel.webBrowser.errors.invalidUrl': 'This web address is invalid.',
  'artifactPanel.webBrowser.errors.unsupportedProtocol': 'This URL protocol is not supported.',
  'artifactPanel.webBrowser.errors.reservedUrl': 'This internal URL cannot be opened.',
  'artifactPanel.webBrowser.errors.loadFailed': 'Failed to load the page.',
  'artifactPanel.webBrowser.errors.clearCookiesFailed': 'Failed to clear cookies.',
  'artifactPanel.webBrowser.errors.clearSiteDataFailed': 'Failed to clear site data.',
  'artifactPanel.webBrowser.errors.openExternalFailed': 'Failed to open externally.',
  'artifactPanel.webBrowser.success.cookiesCleared': 'Cookies cleared.',
  'artifactPanel.webBrowser.success.siteDataCleared': 'Site data cleared.',
  'artifactPanel.webBrowser.crash.title': 'Web Browser stopped',
  'artifactPanel.webBrowser.crash.message': 'The browser page closed unexpectedly.',
  'artifactPanel.webBrowser.crash.recover': 'Recover Browser',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

interface MockWebviewMethods {
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  reloadIgnoringCache: ReturnType<typeof vi.fn>;
}

type MockWebview = HTMLElement & MockWebviewMethods;

let resizeObserverCallback: ResizeObserverCallback;
let observedAnchor: Element | null;
let visualViewport: EventTarget;
let animationFrames: Map<number, FrameRequestCallback>;
let nextAnimationFrame: number;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe(target: Element) {
    observedAnchor = target;
  }

  unobserve() {}

  disconnect() {
    observedAnchor = null;
  }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeAnchor(bounds = rect(10.25, 20.5, 640.75, 480.125)) {
  const anchor = document.createElement('div');
  const getBoundingClientRect = vi.fn(() => bounds);
  anchor.getBoundingClientRect = getBoundingClientRect;
  document.body.append(anchor);
  return {
    anchor,
    getBoundingClientRect,
    setBounds(next: DOMRect) {
      bounds = next;
    },
  };
}

function flushAnimationFrame() {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
}

function webview(): MockWebview {
  return screen.getByTestId('web-browser-webview') as MockWebview;
}

function emit(target: Element, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type);
  Object.assign(event, properties);
  fireEvent(target, event);
}

function renderHost(strict = false) {
  const content = (
    <TooltipProvider delayDuration={0}>
      <button type="button" data-testid="artifact-panel-tab-web-browser">Web Browser tab</button>
      <WebBrowserHost />
    </TooltipProvider>
  );
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

function initialize(anchor: HTMLElement) {
  act(() => {
    useArtifactPanel.getState().openWebBrowser();
    useArtifactPanel.getState().setWebBrowserAnchor(anchor);
  });
}

function openMoreMenu() {
  fireEvent.pointerDown(screen.getByTestId('web-browser-more'), {
    button: 0,
    ctrlKey: false,
  });
}

beforeEach(() => {
  useArtifactPanel.setState({
    open: false,
    tab: 'changes',
    webBrowserInitialized: false,
    webBrowserAnchor: null,
    webBrowserNavigation: null,
    webBrowserNavigationId: 0,
  });
  hostApiMocks.navigate.mockResolvedValue(undefined);
  hostApiMocks.clearCookies.mockResolvedValue(undefined);
  hostApiMocks.clearSiteData.mockResolvedValue(undefined);
  hostApiMocks.openExternal.mockResolvedValue(undefined);

  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    const element = Document.prototype.createElement.call(document, tagName, options);
    if (tagName.toLowerCase() !== 'webview') return element;

    Object.assign(element, {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      getTitle: vi.fn(() => ''),
      getURL: vi.fn(() => WEB_BROWSER_INITIAL_URL),
      goBack: vi.fn(),
      goForward: vi.fn(),
      isLoading: vi.fn(() => false),
      loadURL: vi.fn(),
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    } satisfies MockWebviewMethods);
    element.tabIndex = -1;
    return element;
  });

  observedAnchor = null;
  globalThis.ResizeObserver = TestResizeObserver;
  visualViewport = new EventTarget();
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: visualViewport,
  });
  animationFrames = new Map();
  nextAnimationFrame = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextAnimationFrame++;
    animationFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    animationFrames.delete(id);
  });
});

describe('WebBrowserHost lifecycle', () => {
  it('consumes a queued navigation after the browser guest first attaches', async () => {
    const { anchor } = makeAnchor();
    renderHost();

    act(() => {
      useArtifactPanel.getState().openWebBrowser('file:///workspace/site.html');
      useArtifactPanel.getState().setWebBrowserAnchor(anchor);
    });
    expect(hostApiMocks.navigate).not.toHaveBeenCalled();

    emit(webview(), 'did-attach');

    await waitFor(() => {
      expect(hostApiMocks.navigate).toHaveBeenCalledTimes(1);
      expect(hostApiMocks.navigate).toHaveBeenCalledWith('file:///workspace/site.html');
    });
    expect(screen.getByTestId('web-browser-address-display')).toHaveAccessibleName(
      /file:\/\/\/workspace\/site\.html/,
    );
  });

  it('creates one fixed, preload-free guest lazily and preserves its DOM identity while hidden', async () => {
    const { anchor } = makeAnchor();
    renderHost();
    expect(screen.queryByTestId('web-browser-webview')).not.toBeInTheDocument();

    initialize(anchor);
    const guest = webview();
    const host = screen.getByTestId('web-browser-host');
    expect(document.querySelectorAll('webview')).toHaveLength(1);
    expect(guest).toHaveAttribute('src', WEB_BROWSER_INITIAL_URL);
    expect(guest).toHaveAttribute('partition', WEB_BROWSER_PARTITION);
    expect(guest).toHaveAttribute('useragent', WEB_BROWSER_USER_AGENT);
    expect(guest).toHaveAttribute('allowpopups');
    expect(guest).not.toHaveAttribute('preload');
    await waitFor(() => expect(screen.getByTestId('web-browser-address-input')).toHaveFocus());
    expect(host).toHaveStyle({ visibility: 'visible', pointerEvents: 'auto' });
    expect(host).toHaveAttribute('aria-hidden', 'false');
    expect(host).not.toHaveAttribute('inert');

    guest.focus();
    act(() => useArtifactPanel.getState().setTab('changes'));
    expect(webview()).toBe(guest);
    expect(host).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });
    expect(host).toHaveAttribute('aria-hidden', 'true');
    expect(host).toHaveAttribute('inert');
    await waitFor(() => expect(screen.getByTestId('artifact-panel-tab-web-browser')).toHaveFocus());

    act(() => useArtifactPanel.getState().close());
    expect(webview()).toBe(guest);
    act(() => useArtifactPanel.getState().setWebBrowserAnchor(null));
    expect(webview()).toBe(guest);
    act(() => {
      useArtifactPanel.getState().openWebBrowser();
      useArtifactPanel.getState().setWebBrowserAnchor(anchor);
    });
    expect(webview()).toBe(guest);
    expect(document.querySelectorAll('webview')).toHaveLength(1);
  });

  it('tracks fractional anchor geometry from every viewport signal and coalesces updates', () => {
    const { anchor, getBoundingClientRect, setBounds } = makeAnchor();
    const addEventListener = vi.spyOn(window, 'addEventListener');
    renderHost();
    initialize(anchor);

    const host = screen.getByTestId('web-browser-host');
    expect(host).toHaveStyle({
      position: 'fixed',
      left: '10.25px',
      top: '20.5px',
      width: '640.75px',
      height: '480.125px',
    });
    expect(observedAnchor).toBe(anchor);
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);

    getBoundingClientRect.mockClear();
    setBounds(rect(30.75, 40.125, 500.5, 300.25));
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('resize'));
    fireEvent.scroll(anchor);
    expect(getBoundingClientRect).not.toHaveBeenCalled();
    act(flushAnimationFrame);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(host).toHaveStyle({ left: '30.75px', top: '40.125px', width: '500.5px', height: '300.25px' });

    setBounds(rect(1.5, 2.25, 3.75, 4.5));
    act(() => resizeObserverCallback([], {} as ResizeObserver));
    act(flushAnimationFrame);
    expect(host).toHaveStyle({ left: '1.5px', top: '2.25px', width: '3.75px', height: '4.5px' });

    setBounds(rect(9.125, 8.25, 7.5, 6.75));
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    act(flushAnimationFrame);
    expect(host).toHaveStyle({ left: '9.125px', top: '8.25px', width: '7.5px', height: '6.75px' });

    setBounds(rect(9.125, 8.25, 0, 6.75));
    act(() => resizeObserverCallback([], {} as ResizeObserver));
    act(flushAnimationFrame);
    expect(host).toHaveStyle({ visibility: 'hidden', pointerEvents: 'none' });
    expect(host).toHaveAttribute('inert');
  });

  it('synchronizes attachment, loading, title, main-frame URL, and history without duplicate strict-mode listeners', () => {
    const { anchor } = makeAnchor();
    renderHost(true);
    initialize(anchor);
    const guest = webview();
    guest.canGoBack.mockReturnValue(true);
    guest.canGoForward.mockReturnValue(true);
    guest.getURL.mockReturnValue('https://attached.example/');
    guest.getTitle.mockReturnValue('Attached title');
    guest.isLoading.mockReturnValue(true);

    emit(guest, 'did-attach');
    expect(screen.getByTestId('web-browser-host')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('web-browser-back')).toBeEnabled();
    expect(screen.getByTestId('web-browser-forward')).toBeEnabled();

    fireEvent.blur(screen.getByTestId('web-browser-address-input'));
    emit(guest, 'page-title-updated', { title: 'Document title' });
    emit(guest, 'did-navigate', { url: 'https://example.com/docs' });
    emit(guest, 'page-favicon-updated', { favicons: ['https://example.com/favicon.svg'] });
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('Document title');
    expect(screen.getByTestId('web-browser-favicon')).toHaveAttribute(
      'src',
      'https://example.com/favicon.svg',
    );

    emit(guest, 'did-navigate-in-page', { isMainFrame: false, url: 'https://subframe.example/#ignored' });
    expect(screen.getByTestId('web-browser-address-display')).toHaveAccessibleName(/https:\/\/example\.com\/docs/);
    emit(guest, 'did-navigate-in-page', { isMainFrame: true, url: 'https://example.com/docs#section' });
    expect(screen.getByTestId('web-browser-address-display')).toHaveAccessibleName(/#section/);

    emit(guest, 'did-start-loading');
    expect(screen.getByTestId('web-browser-host')).toHaveAttribute('aria-busy', 'true');
    emit(guest, 'did-stop-loading');
    expect(screen.getByTestId('web-browser-host')).toHaveAttribute('aria-busy', 'false');

    emit(guest, 'did-start-navigation', { isMainFrame: false, isInPlace: false });
    expect(screen.getByTestId('web-browser-favicon')).toBeInTheDocument();
    emit(guest, 'did-start-navigation', { isMainFrame: true, isInPlace: true });
    expect(screen.getByTestId('web-browser-favicon')).toBeInTheDocument();
    emit(guest, 'did-start-navigation', {
      isMainFrame: true,
      isInPlace: false,
      url: 'https://example.com/next',
    });
    expect(screen.getByTestId('web-browser-favicon')).toBeInTheDocument();
    emit(guest, 'did-start-navigation', {
      isMainFrame: true,
      isInPlace: false,
      url: 'https://other.example/',
    });
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
    expect(screen.getByTestId('web-browser-favicon-placeholder')).toBeInTheDocument();

    emit(guest, 'did-navigate', { url: 'https://example.com/redirect' });
    emit(guest, 'page-favicon-updated', { favicons: ['https://example.com/favicon.svg'] });
    emit(guest, 'did-redirect-navigation', {
      isMainFrame: true,
      isInPlace: false,
      url: 'https://redirected.example/',
    });
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();

    emit(guest, 'did-navigate', { url: 'file:///tmp/first.html' });
    emit(guest, 'page-favicon-updated', { favicons: ['file:///tmp/first.svg'] });
    emit(guest, 'did-start-navigation', {
      isMainFrame: true,
      isInPlace: false,
      url: 'file:///tmp/second.html',
    });
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
  });

  it('ignores subframe and aborted failures and reports another main-frame failure once', () => {
    const { anchor } = makeAnchor();
    renderHost(true);
    initialize(anchor);
    const guest = webview();

    emit(guest, 'did-fail-load', { isMainFrame: false, errorCode: -105, validatedURL: 'https://frame.example/' });
    emit(guest, 'did-fail-load', { isMainFrame: true, errorCode: -3, validatedURL: 'https://example.com/' });
    expect(toastMocks.error).not.toHaveBeenCalled();

    emit(guest, 'did-fail-load', { isMainFrame: true, errorCode: -105, validatedURL: 'https://example.com/' });
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to load the page.');
  });

  it('routes address navigation only through Host API, keeps editing on rejection, and deduplicates its load failure', async () => {
    const { anchor } = makeAnchor();
    let rejectNavigation!: (reason: unknown) => void;
    hostApiMocks.navigate.mockImplementation(() => new Promise((_, reject) => {
      rejectNavigation = reject;
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();

    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'example.com/failure' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });
    expect(hostApiMocks.navigate).toHaveBeenCalledWith('https://example.com/failure');
    expect(guest.loadURL).not.toHaveBeenCalled();

    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -105,
      validatedURL: 'https://example.com/failure',
    });
    rejectNavigation(new Error('network failed'));
    await waitFor(() => expect(screen.getByTestId('web-browser-address-input')).toHaveFocus());
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(guest.loadURL).not.toHaveBeenCalled();

    hostApiMocks.navigate.mockRejectedValueOnce(new Error('policy rejected'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'rejected.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(2));
    expect(toastMocks.error).toHaveBeenLastCalledWith('Failed to load the page.');
    expect(screen.getByTestId('web-browser-address-input')).toHaveFocus();
  });

  it('deduplicates a redirected load failure against the active Host API rejection', async () => {
    const { anchor } = makeAnchor();
    let rejectNavigation!: (reason: unknown) => void;
    hostApiMocks.navigate.mockImplementation(() => new Promise((_, reject) => {
      rejectNavigation = reject;
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();

    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'redirect.example/start' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });
    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -105,
      validatedURL: 'https://destination.example/failure',
    });
    rejectNavigation(new Error('redirect destination failed'));

    await waitFor(() => expect(screen.getByTestId('web-browser-address-input')).toHaveFocus());
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to load the page.');
  });

  it('keeps an active aborted navigation silent when Main resolves its cancellation', async () => {
    const { anchor } = makeAnchor();
    let resolveNavigation!: () => void;
    hostApiMocks.navigate.mockImplementation(() => new Promise<void>((resolve) => {
      resolveNavigation = resolve;
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();
    const input = screen.getByTestId('web-browser-address-input');

    fireEvent.change(input, { target: { value: 'aborted.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -3,
      validatedURL: 'https://aborted.example/',
    });
    resolveNavigation();

    await waitFor(() => expect(input).toHaveFocus());
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('does not let an older same-URL abort silence a genuine newer failure', async () => {
    const { anchor } = makeAnchor();
    const resolveNavigation: Array<() => void> = [];
    const rejectNavigation: Array<(reason: unknown) => void> = [];
    hostApiMocks.navigate.mockImplementation(() => new Promise<void>((resolve, reject) => {
      resolveNavigation.push(resolve);
      rejectNavigation.push(reject);
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();
    const input = screen.getByTestId('web-browser-address-input');

    fireEvent.change(input, { target: { value: 'same.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'same.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(hostApiMocks.navigate).toHaveBeenNthCalledWith(1, 'https://same.example/');
    expect(hostApiMocks.navigate).toHaveBeenNthCalledWith(2, 'https://same.example/');

    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -3,
      validatedURL: 'https://same.example/',
    });
    resolveNavigation[0]();
    await act(async () => Promise.resolve());
    expect(toastMocks.error).not.toHaveBeenCalled();

    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -105,
      validatedURL: 'https://same.example/',
    });
    rejectNavigation[1](new Error('newer request rejected'));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1));
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to load the page.');
  });

  it('does not let an unmatched redirected abort silence a genuine newer failure', async () => {
    const { anchor } = makeAnchor();
    const resolveNavigation: Array<() => void> = [];
    const rejectNavigation: Array<(reason: unknown) => void> = [];
    hostApiMocks.navigate.mockImplementation(() => new Promise<void>((resolve, reject) => {
      resolveNavigation.push(resolve);
      rejectNavigation.push(reject);
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();
    const input = screen.getByTestId('web-browser-address-input');

    fireEvent.change(input, { target: { value: 'redirect.example/start' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'newer.example' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -3,
      validatedURL: 'https://redirected.example/destination',
    });
    resolveNavigation[0]();
    await act(async () => Promise.resolve());
    expect(toastMocks.error).not.toHaveBeenCalled();

    emit(guest, 'did-fail-load', {
      isMainFrame: true,
      errorCode: -105,
      validatedURL: 'https://newer.example/failure',
    });
    rejectNavigation[1](new Error('newer request rejected'));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledTimes(1));
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to load the page.');
  });

  it('calls attached navigation methods and sequences clear and external actions safely', async () => {
    const { anchor } = makeAnchor();
    renderHost();
    initialize(anchor);
    const guest = webview();
    guest.canGoBack.mockReturnValue(true);
    guest.canGoForward.mockReturnValue(true);
    emit(guest, 'did-attach');
    emit(guest, 'did-navigate', { url: 'https://example.com/' });

    fireEvent.click(screen.getByTestId('web-browser-back'));
    fireEvent.click(screen.getByTestId('web-browser-forward'));
    fireEvent.click(screen.getByTestId('web-browser-refresh'));
    expect(guest.goBack).toHaveBeenCalledTimes(1);
    expect(guest.goForward).toHaveBeenCalledTimes(1);
    expect(guest.reload).toHaveBeenCalledTimes(1);

    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-force-refresh'));
    expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(1);

    let resolveCookies!: () => void;
    hostApiMocks.clearCookies.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCookies = resolve;
    }));
    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-cookies'));
    expect(hostApiMocks.clearCookies).toHaveBeenCalledTimes(1);
    expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(1);
    resolveCookies();
    await waitFor(() => expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(2));

    hostApiMocks.clearCookies.mockRejectedValueOnce(new Error('clear failed'));
    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-cookies'));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('Failed to clear cookies.'));
    expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(2);

    hostApiMocks.clearSiteData.mockResolvedValueOnce(undefined);
    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-site-data'));
    await waitFor(() => expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(3));

    hostApiMocks.clearSiteData.mockRejectedValueOnce(new Error('clear failed'));
    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-site-data'));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('Failed to clear site data.'));
    expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(3);

    hostApiMocks.openExternal.mockRejectedValueOnce(new Error('open failed'));
    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-open-external'));
    await waitFor(() => expect(hostApiMocks.openExternal).toHaveBeenCalledWith());
    expect(toastMocks.error).toHaveBeenCalledWith('Failed to open externally.');
  });

  it('force-refreshes the same guest when it becomes attached during a clear operation', async () => {
    const { anchor } = makeAnchor();
    let resolveCookies!: () => void;
    hostApiMocks.clearCookies.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCookies = resolve;
    }));
    renderHost();
    initialize(anchor);
    const guest = webview();

    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-cookies'));
    expect(hostApiMocks.clearCookies).toHaveBeenCalledTimes(1);
    emit(guest, 'did-attach');
    resolveCookies();

    await waitFor(() => expect(guest.reloadIgnoringCache).toHaveBeenCalledTimes(1));
  });

  it('does not refresh a failed or replacement guest when replacement occurs during clear', async () => {
    const { anchor } = makeAnchor();
    let resolveSiteData!: () => void;
    hostApiMocks.clearSiteData.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSiteData = resolve;
    }));
    renderHost();
    initialize(anchor);
    const failedGuest = webview();
    emit(failedGuest, 'did-attach');

    openMoreMenu();
    fireEvent.click(await screen.findByTestId('web-browser-clear-site-data'));
    emit(failedGuest, 'render-process-gone', { details: { reason: 'crashed', exitCode: 1 } });
    await waitFor(() => expect(failedGuest).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Recover Browser' }));
    const replacement = webview();
    emit(replacement, 'did-attach');
    resolveSiteData();

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('Site data cleared.'));
    expect(failedGuest.reloadIgnoringCache).not.toHaveBeenCalled();
    expect(replacement.reloadIgnoringCache).not.toHaveBeenCalled();
  });

  it('removes a crashed guest and restores the last allowed URL only after replacement attachment', async () => {
    const { anchor } = makeAnchor();
    renderHost();
    initialize(anchor);
    const failedGuest = webview();
    emit(failedGuest, 'did-attach');
    emit(failedGuest, 'did-navigate', { url: 'https://example.com/last' });

    emit(failedGuest, 'render-process-gone', { details: { reason: 'crashed', exitCode: 1 } });
    await waitFor(() => expect(failedGuest).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Web Browser stopped');
    expect(document.querySelectorAll('webview')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Recover Browser' }));
    const replacement = webview();
    expect(replacement).not.toBe(failedGuest);
    expect(replacement).toHaveAttribute('src', WEB_BROWSER_INITIAL_URL);
    expect(document.querySelectorAll('webview')).toHaveLength(1);
    expect(hostApiMocks.navigate).not.toHaveBeenCalled();

    hostApiMocks.navigate.mockRejectedValueOnce(new Error('recovery failed'));
    emit(replacement, 'did-attach');
    await waitFor(() => expect(hostApiMocks.navigate).toHaveBeenCalledWith('https://example.com/last'));
    expect(replacement.loadURL).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('Failed to load the page.'));
  });
});
