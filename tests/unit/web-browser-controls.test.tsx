import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  getWebBrowserDisplayText,
  WebBrowserAddressControl,
} from '@/components/web-browser/WebBrowserAddressControl';
import { WebBrowserToolbar } from '@/components/web-browser/WebBrowserToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
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
    }[key] ?? key),
  }),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderAddress(
  props: Partial<React.ComponentProps<typeof WebBrowserAddressControl>> = {},
) {
  const callbacks = {
    onNavigate: vi.fn(),
    onAddressError: vi.fn(),
  };
  const result = render(
    <TooltipProvider delayDuration={0}>
      <WebBrowserAddressControl
        title="Example document"
        url="https://example.com/a/very/long/path"
        faviconUrl="https://example.com/favicon.ico"
        {...callbacks}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...result, ...callbacks };
}

function toolbarProps(
  overrides: Partial<React.ComponentProps<typeof WebBrowserToolbar>> = {},
): React.ComponentProps<typeof WebBrowserToolbar> {
  return {
    title: 'Example document',
    url: 'https://example.com/',
    faviconUrl: 'https://example.com/favicon.ico',
    canGoBack: true,
    canGoForward: true,
    visible: true,
    crashed: false,
    clearingCookies: false,
    clearingSiteData: false,
    onNavigate: vi.fn(),
    onAddressError: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onRefresh: vi.fn(),
    onForceRefresh: vi.fn(),
    onClearCookies: vi.fn(),
    onClearSiteData: vi.fn(),
    onOpenExternal: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(props: React.ComponentProps<typeof WebBrowserToolbar>) {
  return render(
    <TooltipProvider delayDuration={0}>
      <WebBrowserToolbar {...props} />
    </TooltipProvider>,
  );
}

function openMoreMenu() {
  fireEvent.pointerDown(screen.getByTestId('web-browser-more'), {
    button: 0,
    ctrlKey: false,
  });
}

describe('WebBrowserAddressControl', () => {
  it('uses the document title with a URL fallback', () => {
    expect(getWebBrowserDisplayText('Example document', 'https://example.com/')).toBe('Example document');
    expect(getWebBrowserDisplayText('   ', 'https://example.com/')).toBe('https://example.com/');

    const { rerender } = renderAddress();
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('Example document');

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserAddressControl
          title=""
          url="https://fallback.example/"
          onNavigate={vi.fn()}
          onAddressError={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('https://fallback.example/');
  });

  it('shows the favicon without exposing the full URL in a hover tooltip', async () => {
    renderAddress();

    const display = screen.getByTestId('web-browser-address-display');
    expect(display.querySelector('span[aria-hidden="true"]')).toHaveClass('truncate');
    expect(display).toHaveAccessibleName(/https:\/\/example\.com\/a\/very\/long\/path/);
    expect(screen.getByTestId('web-browser-favicon')).toHaveAttribute(
      'src',
      'https://example.com/favicon.ico',
    );

    fireEvent.pointerMove(display, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('reserves the favicon slot with a same-size placeholder', () => {
    renderAddress({ faviconUrl: null });

    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
    expect(screen.getByTestId('web-browser-favicon-placeholder')).toHaveClass(
      'h-4',
      'w-4',
      'shrink-0',
    );
  });

  it('falls back to the placeholder when the favicon fails to load', () => {
    renderAddress();

    fireEvent.error(screen.getByTestId('web-browser-favicon'));
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
    expect(screen.getByTestId('web-browser-favicon-placeholder')).toBeInTheDocument();
  });

  it('keeps the last loaded same-origin favicon when a new candidate fails', () => {
    const { rerender } = renderAddress();
    fireEvent.load(screen.getByTestId('web-browser-favicon'));

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserAddressControl
          title="Next document"
          url="https://example.com/next"
          faviconUrl="https://example.com/missing.ico"
          onNavigate={vi.fn()}
          onAddressError={vi.fn()}
        />
      </TooltipProvider>,
    );
    fireEvent.error(screen.getByTestId('web-browser-favicon'));

    expect(screen.getByTestId('web-browser-favicon')).toHaveAttribute(
      'src',
      'https://example.com/favicon.ico',
    );
    expect(screen.queryByTestId('web-browser-favicon-placeholder')).not.toBeInTheDocument();

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserAddressControl
          title="No favicon"
          url="https://example.com/no-favicon"
          faviconUrl={null}
          onNavigate={vi.fn()}
          onAddressError={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
    expect(screen.getByTestId('web-browser-favicon-placeholder')).toBeInTheDocument();
  });

  it('enters edit mode on click and selects the current URL', async () => {
    renderAddress();
    fireEvent.click(screen.getByTestId('web-browser-address-display'));

    const input = screen.getByTestId('web-browser-address-input') as HTMLInputElement;
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByTestId('web-browser-favicon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('web-browser-favicon-placeholder')).not.toBeInTheDocument();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input).toHaveValue('https://example.com/a/very/long/path');
  });

  it('focuses and selects the empty input for the initial blank document', async () => {
    renderAddress({ title: '', url: 'about:blank' });

    const input = screen.getByTestId('web-browser-address-input') as HTMLInputElement;
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue('');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
  });

  it('normalizes Enter submissions and exits edit mode after navigation succeeds', async () => {
    const onNavigate = vi.fn();
    renderAddress({ onNavigate });
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: ' example.org/docs ' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('https://example.org/docs');
    await waitFor(() => expect(screen.queryByTestId('web-browser-address-input')).not.toBeInTheDocument());
  });

  it('keeps edit mode when the navigation callback rejects', async () => {
    const onNavigate = vi.fn().mockRejectedValue(new Error('navigation failed'));
    renderAddress({ onNavigate });
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'example.org' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('https://example.org/'));
    expect(screen.getByTestId('web-browser-address-input')).toHaveFocus();
  });

  it('keeps the latest draft editing when an older navigation resolves first', async () => {
    const firstNavigation = deferred();
    const secondNavigation = deferred();
    const onNavigate = vi.fn()
      .mockImplementationOnce(() => firstNavigation.promise)
      .mockImplementationOnce(() => secondNavigation.promise);
    renderAddress({ onNavigate });
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'first.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'second.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });

    firstNavigation.resolve();
    await waitFor(() => {
      expect(screen.getByTestId('web-browser-address-input')).toHaveValue('second.example');
    });

    secondNavigation.reject(new Error('latest navigation failed'));
    await waitFor(() => {
      expect(screen.getByTestId('web-browser-address-input')).toHaveFocus();
    });
  });

  it('ignores an older rejection after the latest navigation succeeds', async () => {
    const firstNavigation = deferred();
    const secondNavigation = deferred();
    const onNavigate = vi.fn()
      .mockImplementationOnce(() => firstNavigation.promise)
      .mockImplementationOnce(() => secondNavigation.promise);
    renderAddress({ onNavigate });
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'first.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'second.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });

    secondNavigation.resolve();
    await waitFor(() => {
      expect(screen.queryByTestId('web-browser-address-input')).not.toBeInTheDocument();
    });
    const display = screen.getByTestId('web-browser-address-display');
    display.focus();

    firstNavigation.reject(new Error('stale navigation failed'));
    await waitFor(() => expect(display).toHaveFocus());
    expect(screen.queryByTestId('web-browser-address-input')).not.toBeInTheDocument();
  });

  it('cancels on Escape and blur without navigating', () => {
    const { onNavigate } = renderAddress();
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'escape.example' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Escape' });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('Example document');

    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'blur.example' },
    });
    fireEvent.blur(screen.getByTestId('web-browser-address-input'));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('Example document');
  });

  it('retains the invalid draft and emits the exact parser error code', () => {
    const onNavigate = vi.fn();
    const onAddressError = vi.fn();
    renderAddress({ onNavigate, onAddressError });
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: '/Users/clawx/report.html' },
    });
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Enter' });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onAddressError).toHaveBeenCalledTimes(1);
    expect(onAddressError).toHaveBeenCalledWith('absolute-path');
    expect(screen.getByTestId('web-browser-address-input')).toHaveValue('/Users/clawx/report.html');
    expect(screen.getByTestId('web-browser-address-input')).toHaveFocus();
  });

  it('does not overwrite an active draft when the page URL changes', () => {
    const { rerender } = renderAddress();
    fireEvent.click(screen.getByTestId('web-browser-address-display'));
    fireEvent.change(screen.getByTestId('web-browser-address-input'), {
      target: { value: 'draft.example/path' },
    });

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserAddressControl
          title="Redirected document"
          url="https://redirected.example/"
          onNavigate={vi.fn()}
          onAddressError={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('web-browser-address-input')).toHaveValue('draft.example/path');
    fireEvent.keyDown(screen.getByTestId('web-browser-address-input'), { key: 'Escape' });
    expect(screen.getByTestId('web-browser-address-display')).toHaveTextContent('Redirected document');
  });
});

describe('WebBrowserToolbar', () => {
  it('uses native disabled navigation semantics and calls toolbar actions exactly once', () => {
    const props = toolbarProps({ canGoBack: false, canGoForward: false });
    renderToolbar(props);

    const back = screen.getByTestId('web-browser-back');
    const forward = screen.getByTestId('web-browser-forward');
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();
    fireEvent.click(back);
    fireEvent.click(forward);
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onForward).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('web-browser-refresh'));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);

    const enabled = toolbarProps();
    renderToolbar(enabled);
    fireEvent.click(screen.getAllByTestId('web-browser-back')[1]);
    fireEvent.click(screen.getAllByTestId('web-browser-forward')[1]);
    expect(enabled.onBack).toHaveBeenCalledTimes(1);
    expect(enabled.onForward).toHaveBeenCalledTimes(1);
  });

  it('calls each More action exactly once', async () => {
    const props = toolbarProps();
    renderToolbar(props);

    for (const [testId, callback] of [
      ['web-browser-force-refresh', props.onForceRefresh],
      ['web-browser-clear-cookies', props.onClearCookies],
      ['web-browser-clear-site-data', props.onClearSiteData],
      ['web-browser-open-external', props.onOpenExternal],
    ] as const) {
      openMoreMenu();
      fireEvent.click(await screen.findByTestId(testId));
      expect(callback).toHaveBeenCalledTimes(1);
    }
  });

  it('shows an icon for every More menu item', async () => {
    renderToolbar(toolbarProps());
    openMoreMenu();

    for (const [testId, iconClass] of [
      ['web-browser-force-refresh', 'lucide-refresh-cw'],
      ['web-browser-clear-cookies', 'lucide-cookie'],
      ['web-browser-clear-site-data', 'lucide-database'],
      ['web-browser-open-external', 'lucide-external-link'],
    ]) {
      expect((await screen.findByTestId(testId)).querySelector('svg')).toHaveClass(iconClass);
    }
  });

  it('disables Open External on about:blank', async () => {
    const props = toolbarProps({ url: 'about:blank' });
    renderToolbar(props);
    openMoreMenu();

    const openExternal = await screen.findByTestId('web-browser-open-external');
    expect(openExternal).toHaveAttribute('data-disabled');
    fireEvent.click(openExternal);
    expect(props.onOpenExternal).not.toHaveBeenCalled();
  });

  it('disables only the matching clear operation while it runs', async () => {
    const props = toolbarProps({ clearingCookies: true, clearingSiteData: false });
    const { rerender } = renderToolbar(props);
    openMoreMenu();

    expect(await screen.findByTestId('web-browser-clear-cookies')).toHaveAttribute('data-disabled');
    expect(screen.getByTestId('web-browser-clear-site-data')).not.toHaveAttribute('data-disabled');
    expect(screen.getByTestId('web-browser-force-refresh')).not.toHaveAttribute('data-disabled');
    expect(screen.getByTestId('web-browser-open-external')).not.toHaveAttribute('data-disabled');

    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserToolbar
          {...props}
          clearingCookies={false}
          clearingSiteData
        />
      </TooltipProvider>,
    );
    openMoreMenu();
    expect(await screen.findByTestId('web-browser-clear-cookies')).not.toHaveAttribute('data-disabled');
    expect(screen.getByTestId('web-browser-clear-site-data')).toHaveAttribute('data-disabled');
  });

  it('closes the controlled More menu when hidden or crashed', async () => {
    const props = toolbarProps();
    const { rerender } = renderToolbar(props);
    openMoreMenu();
    expect(await screen.findByTestId('web-browser-force-refresh')).toBeInTheDocument();

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserToolbar {...props} visible={false} />
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId('web-browser-force-refresh')).not.toBeInTheDocument());

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserToolbar {...props} visible />
      </TooltipProvider>,
    );
    openMoreMenu();
    expect(await screen.findByTestId('web-browser-force-refresh')).toBeInTheDocument();

    rerender(
      <TooltipProvider delayDuration={0}>
        <WebBrowserToolbar {...props} visible crashed />
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId('web-browser-force-refresh')).not.toBeInTheDocument());
  });
});
