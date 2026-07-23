import { startTransition, StrictMode, Suspense, useLayoutEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocxViewer, { type OfficeViewerProps } from '@/components/file-preview/DocxViewer';
import PptxViewer, { type PptxViewerProps } from '@/components/file-preview/PptxViewer';

const OFFICE_MAX_BYTES = 20 * 1024 * 1024;
const LOCALIZED_LOAD_FAILURE = 'Localized Word document failed to load';
const LOCALIZED_PPTX_LOAD_FAILURE = 'Localized presentation failed to load';
const LOCALIZED_TOO_LARGE = 'Localized file too large';

const readBinaryFile = vi.fn();
const readWorkspaceBinary = vi.fn();
const readAttachmentBinary = vi.fn();
const renderAsync = vi.fn();

interface MockPptxViewer {
  destroy: ReturnType<typeof vi.fn>;
  getSlideCount: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}

const createPptxViewer = vi.fn();
const pptxInstances: MockPptxViewer[] = [];
let nextPptxSlideCount = 3;
let pptxRenderImplementation: ((
  instance: MockPptxViewer,
  canvas: HTMLCanvasElement,
  options: { slideIndex: number },
) => Promise<void>) | undefined;

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: (...args: unknown[]) => readBinaryFile(...args),
  readWorkspaceBinary: (...args: unknown[]) => readWorkspaceBinary(...args),
  readAttachmentBinary: (...args: unknown[]) => readAttachmentBinary(...args),
}));

vi.mock('docx-preview', () => ({
  renderAsync: (...args: unknown[]) => renderAsync(...args),
}));

vi.mock('pptxviewjs', () => ({
  PPTXViewer: function MockPPTXViewer(options: Record<string, unknown>) {
    return createPptxViewer(options);
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (key === 'filePreview.docx.loadFailed') return LOCALIZED_LOAD_FAILURE;
      if (key === 'filePreview.pptx.loadFailed') return LOCALIZED_PPTX_LOAD_FAILURE;
      if (key === 'filePreview.errors.tooLarge') return LOCALIZED_TOO_LARGE;
      if (key === 'filePreview.pptx.previous') return 'Previous slide';
      if (key === 'filePreview.pptx.next') return 'Next slide';
      if (key === 'filePreview.pptx.slidePosition') {
        const values = fallback as { current?: number; total?: number };
        return `${values.current} / ${values.total}`;
      }
      return typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key;
    },
  }),
}));

interface ResizeObserverRecord {
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
}

const resizeObservers: ResizeObserverRecord[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function appendRenderedPage(body: HTMLElement, width = 800, text = 'Rendered document') {
  const page = body.ownerDocument.createElement('section');
  page.className = 'clawx-docx';
  page.textContent = text;
  Object.defineProperty(page, 'offsetWidth', { configurable: true, value: width });
  body.append(page);
  return page;
}

function successfulRead(byte = 1) {
  return {
    ok: true,
    data: Uint8Array.from([byte]),
    size: 1,
    readOnly: true,
  };
}

function setPptxSize(width = 960, height = 540) {
  const canvas = screen.getByTestId('pptx-canvas');
  const container = canvas.parentElement as HTMLElement;
  Object.defineProperties(container, {
    clientHeight: { configurable: true, get: () => height },
    clientWidth: { configurable: true, get: () => width },
  });
  return { canvas, container };
}

async function renderPptx(props: PptxViewerProps = { filePath: '/tmp/slides.pptx' }) {
  const result = render(<PptxViewer {...props} />);
  const elements = setPptxSize();
  await waitFor(() => expect(pptxInstances).toHaveLength(1));
  await waitFor(() => expect(pptxInstances[0].render).toHaveBeenCalled());
  return { ...result, ...elements, instance: pptxInstances[0] };
}

async function findInDocxShadow(text: string): Promise<HTMLElement> {
  const host = screen.getByTestId('docx-preview-host');
  await waitFor(() => expect(host.shadowRoot).toHaveTextContent(text));
  const element = Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>('*') ?? [])
    .find((candidate) => candidate.textContent === text);
  expect(element).toBeDefined();
  return element as HTMLElement;
}

describe('DocxViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resizeObservers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      readonly record: ResizeObserverRecord;

      constructor(callback: ResizeObserverCallback) {
        this.record = {
          callback,
          disconnect: vi.fn(),
          observe: vi.fn(),
        };
        resizeObservers.push(this.record);
      }

      observe(target: Element) {
        this.record.observe(target);
      }

      unobserve() {}

      disconnect() {
        this.record.disconnect();
      }
    });
    renderAsync.mockImplementation(async (bytes: Uint8Array, body: HTMLElement, styles: HTMLElement) => {
      appendRenderedPage(body, 800, `Rendered byte ${bytes[0]}`);
      styles.append(styles.ownerDocument.createElement('style'));
    });
  });

  it.each([
    {
      name: 'ordinary local',
      props: { filePath: '/tmp/report.docx' } satisfies OfficeViewerProps,
      arrange: () => readBinaryFile.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readBinaryFile).toHaveBeenCalledWith('/tmp/report.docx', { maxBytes: OFFICE_MAX_BYTES }),
      unused: () => {
        expect(readWorkspaceBinary).not.toHaveBeenCalled();
        expect(readAttachmentBinary).not.toHaveBeenCalled();
      },
    },
    {
      name: 'workspace-scoped',
      props: {
        filePath: 'reports/report.docx',
        workspaceFileRef: { workspaceRoot: '/workspace', relativePath: 'reports/report.docx' },
      } satisfies OfficeViewerProps,
      arrange: () => readWorkspaceBinary.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readWorkspaceBinary).toHaveBeenCalledWith({
        workspaceRoot: '/workspace',
        relativePath: 'reports/report.docx',
        maxBytes: OFFICE_MAX_BYTES,
      }),
      unused: () => {
        expect(readBinaryFile).not.toHaveBeenCalled();
        expect(readAttachmentBinary).not.toHaveBeenCalled();
      },
    },
    {
      name: 'attachment-scoped',
      props: {
        filePath: 'report.docx',
        attachmentFileRef: {
          sessionKey: 'agent:main:session-1',
          generation: 4,
          uri: 'file:///private/report.docx',
        },
      } satisfies OfficeViewerProps,
      arrange: () => readAttachmentBinary.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readAttachmentBinary).toHaveBeenCalledWith({
        sessionKey: 'agent:main:session-1',
        generation: 4,
        uri: 'file:///private/report.docx',
      }, OFFICE_MAX_BYTES),
      unused: () => {
        expect(readBinaryFile).not.toHaveBeenCalled();
        expect(readWorkspaceBinary).not.toHaveBeenCalled();
      },
    },
  ])('uses only the $name authorized binary route with the Office limit', async ({ arrange, expected, props, unused }) => {
    arrange();
    render(<DocxViewer {...props} />);

    expect(await findInDocxShadow('Rendered byte 1')).toBeVisible();
    expected();
    unused();
  });

  it('rejects simultaneous scoped references before any read', async () => {
    render(
      <DocxViewer
        filePath="report.docx"
        workspaceFileRef={{ workspaceRoot: '/workspace', relativePath: 'report.docx' }}
        attachmentFileRef={{
          sessionKey: 'agent:main:session-1',
          generation: 1,
          uri: 'file:///private/report.docx',
        }}
      />,
    );

    expect(await screen.findByText(LOCALIZED_LOAD_FAILURE)).toBeVisible();
    expect(readBinaryFile).not.toHaveBeenCalled();
    expect(readWorkspaceBinary).not.toHaveBeenCalled();
    expect(readAttachmentBinary).not.toHaveBeenCalled();
    expect(renderAsync).not.toHaveBeenCalled();
  });

  it('passes detached target-specific containers and the exact safe render options', async () => {
    const pendingRender = deferred();
    readBinaryFile.mockResolvedValueOnce(successfulRead(7));
    renderAsync.mockImplementationOnce(async (bytes: Uint8Array, body: HTMLElement, styles: HTMLElement) => {
      appendRenderedPage(body, 800, `Rendered byte ${bytes[0]}`);
      styles.append(styles.ownerDocument.createElement('style'));
      await pendingRender.promise;
    });
    render(<DocxViewer filePath="/tmp/report.docx" />);

    await waitFor(() => expect(renderAsync).toHaveBeenCalledOnce());
    const [bytes, body, styles, options] = renderAsync.mock.calls[0] as [
      Uint8Array,
      HTMLElement,
      HTMLElement,
      Record<string, unknown>,
    ];

    expect(bytes).toEqual(Uint8Array.from([7]));
    expect(body).not.toBe(styles);
    expect(body.isConnected).toBe(false);
    expect(styles.isConnected).toBe(false);
    expect(body.parentNode).toBeNull();
    expect(styles.parentNode).toBeNull();
    expect(options).toEqual({
      className: 'clawx-docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderChanges: false,
      renderComments: false,
      renderAltChunks: false,
      useBase64URL: true,
      experimental: false,
      debug: false,
    });

    await act(async () => pendingRender.resolve());
  });

  it('publishes detached containers to an open shadow root only after rendering finishes', async () => {
    const pendingRender = deferred();
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement, styles: HTMLElement) => {
      appendRenderedPage(body);
      styles.append(styles.ownerDocument.createElement('style'));
      await pendingRender.promise;
    });

    render(<DocxViewer filePath="/tmp/report.docx" />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledOnce());

    const host = screen.getByTestId('docx-preview-host');
    const shadowRoot = host.shadowRoot;
    expect(shadowRoot).not.toBeNull();
    expect(shadowRoot?.mode).toBe('open');
    expect(shadowRoot?.childNodes).toHaveLength(0);

    await act(async () => pendingRender.resolve());

    const [, body, styles] = renderAsync.mock.calls[0] as [Uint8Array, HTMLElement, HTMLElement];
    await waitFor(() => expect(shadowRoot?.contains(body)).toBe(true));
    expect(shadowRoot?.contains(styles)).toBe(true);
    expect(screen.getByTestId('docx-viewer')).toBeVisible();
  });

  it('does not allow a stale render to mutate the visible target', async () => {
    const firstRender = deferred();
    const secondRender = deferred();
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'report.docx' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'report.docx' };
    readWorkspaceBinary
      .mockResolvedValueOnce(successfulRead(1))
      .mockResolvedValueOnce(successfulRead(2));
    renderAsync.mockImplementation(async (bytes: Uint8Array, body: HTMLElement) => {
      await (bytes[0] === 1 ? firstRender.promise : secondRender.promise);
      appendRenderedPage(body, 800, bytes[0] === 1 ? 'Old document' : 'Current document');
    });

    const { rerender } = render(
      <DocxViewer filePath="report.docx" workspaceFileRef={firstRef} />,
    );
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(1));

    rerender(<DocxViewer filePath="report.docx" workspaceFileRef={secondRef} />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(2));

    await act(async () => secondRender.resolve());
    expect(await findInDocxShadow('Current document')).toBeVisible();

    await act(async () => firstRender.resolve());
    const shadowRoot = screen.getByTestId('docx-preview-host').shadowRoot;
    expect(shadowRoot).toHaveTextContent('Current document');
    expect(shadowRoot).not.toHaveTextContent('Old document');
  });

  it('allows a committed load to publish while a replacement render is interrupted', async () => {
    const committedRender = deferred();
    const interruptedRender = deferred();
    const replacementRenderAttempted = vi.fn();
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'report.docx' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'report.docx' };

    readWorkspaceBinary.mockResolvedValueOnce(successfulRead(1));
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement) => {
      await committedRender.promise;
      appendRenderedPage(body, 800, 'Committed document');
    });

    function InterruptReplacement({ interrupted }: { interrupted: boolean }) {
      if (interrupted) {
        replacementRenderAttempted();
        throw interruptedRender.promise;
      }
      return null;
    }

    function ConcurrentHarness() {
      const [workspaceFileRef, setWorkspaceFileRef] = useState(firstRef);
      return (
        <>
          <button
            type="button"
            onClick={() => startTransition(() => setWorkspaceFileRef(secondRef))}
          >
            Replace target
          </button>
          <Suspense fallback={<div>Replacement suspended</div>}>
            <DocxViewer filePath="report.docx" workspaceFileRef={workspaceFileRef} />
            <InterruptReplacement interrupted={workspaceFileRef === secondRef} />
          </Suspense>
        </>
      );
    }

    render(<ConcurrentHarness />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Replace target' }));
    await waitFor(() => expect(replacementRenderAttempted).toHaveBeenCalled());
    expect(readWorkspaceBinary).toHaveBeenCalledOnce();

    await act(async () => committedRender.resolve());

    expect(await findInDocxShadow('Committed document')).toBeVisible();
    expect(readWorkspaceBinary).toHaveBeenCalledOnce();
  });

  it('invalidates the prior load when a replacement commits before passive effects run', async () => {
    const firstRender = deferred();
    const secondRead = deferred<ReturnType<typeof successfulRead>>();
    const replacementCommitted = deferred();
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'report.docx' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'report.docx' };
    readWorkspaceBinary
      .mockResolvedValueOnce(successfulRead(1))
      .mockReturnValueOnce(secondRead.promise);
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement) => {
      await firstRender.promise;
      appendRenderedPage(body, 800, 'Superseded document');
    });

    function ResolveFirstAfterReplacementCommit({ replaced }: { replaced: boolean }) {
      useLayoutEffect(() => {
        if (replaced) {
          firstRender.resolve();
          replacementCommitted.resolve();
        }
      }, [replaced]);
      return null;
    }

    function CommitHarness() {
      const [workspaceFileRef, setWorkspaceFileRef] = useState(firstRef);
      const replaced = workspaceFileRef === secondRef;
      return (
        <>
          <button
            type="button"
            onClick={() => startTransition(() => setWorkspaceFileRef(secondRef))}
          >
            Commit replacement
          </button>
          <DocxViewer filePath="report.docx" workspaceFileRef={workspaceFileRef} />
          <ResolveFirstAfterReplacementCommit replaced={replaced} />
        </>
      );
    }

    render(<CommitHarness />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledOnce());
    const shadowRoot = screen.getByTestId('docx-preview-host').shadowRoot;
    expect(shadowRoot).not.toBeNull();
    const publishedText: string[] = [];
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) publishedText.push(node.textContent ?? '');
      }
    });
    mutationObserver.observe(shadowRoot as ShadowRoot, { childList: true, subtree: true });

    screen.getByRole('button', { name: 'Commit replacement' }).click();
    await replacementCommitted.promise;
    await waitFor(() => expect(readWorkspaceBinary).toHaveBeenCalledTimes(2));

    expect(publishedText.join('\n')).not.toContain('Superseded document');
    expect(shadowRoot).not.toHaveTextContent('Superseded document');
    mutationObserver.disconnect();
  });

  it.each([
    '#section',
    'https://example.com/report',
    'file:///private/other.docx',
    'custom-protocol:payload',
  ])('prevents the default action for rendered anchor %s', async (href) => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement) => {
      const anchor = body.ownerDocument.createElement('a');
      anchor.href = href;
      anchor.textContent = href;
      body.append(anchor);
    });
    render(<DocxViewer filePath="/tmp/report.docx" />);

    await findInDocxShadow(href);
    const anchor = screen.getByTestId('docx-preview-host').shadowRoot?.querySelector('a');
    expect(anchor).not.toBeNull();
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    fireEvent(anchor as HTMLAnchorElement, click);

    expect(click.defaultPrevented).toBe(true);
  });

  it.each([
    '#section',
    'https://example.com/report',
    'file:///private/other.docx',
    'custom-protocol:payload',
  ])('prevents middle-click activation for rendered anchor %s', async (href) => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement) => {
      const anchor = body.ownerDocument.createElement('a');
      anchor.href = href;
      anchor.textContent = href;
      body.append(anchor);
    });
    render(<DocxViewer filePath="/tmp/report.docx" />);

    await findInDocxShadow(href);
    const anchor = screen.getByTestId('docx-preview-host').shadowRoot?.querySelector('a');
    expect(anchor).not.toBeNull();
    const auxClick = new MouseEvent('auxclick', {
      bubbles: true,
      button: 1,
      cancelable: true,
      composed: true,
    });
    fireEvent(anchor as HTMLAnchorElement, auxClick);

    expect(auxClick.defaultPrevented).toBe(true);
  });

  it('scales down to available width, never enlarges, and disconnects its observer', async () => {
    let availableWidth = 1200;
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement) => {
      appendRenderedPage(body, 800);
    });
    const { unmount } = render(<DocxViewer filePath="/tmp/report.docx" />);
    const host = screen.getByTestId('docx-preview-host');
    Object.defineProperty(host, 'clientWidth', {
      configurable: true,
      get: () => availableWidth,
    });

    expect(await findInDocxShadow('Rendered document')).toBeVisible();
    const [, body] = renderAsync.mock.calls[0] as [Uint8Array, HTMLElement];
    expect(body.style.zoom).toBe('1');
    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0].observe).toHaveBeenCalledWith(host);

    availableWidth = 400;
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    expect(body.style.zoom).toBe('0.5');

    availableWidth = 1600;
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    expect(body.style.zoom).toBe('1');

    unmount();
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ['read failure', { ok: false, error: 'outsideSandbox' }],
    ['empty data', { ok: true, data: undefined, size: 0 }],
  ])('shows one localized generic failure for %s without leaking details', async (_name, response) => {
    readBinaryFile.mockResolvedValueOnce(response);
    render(<DocxViewer filePath="/tmp/report.docx" />);

    expect(await screen.findByText(LOCALIZED_LOAD_FAILURE)).toBeVisible();
    expect(screen.queryByText(/tooLarge|outsideSandbox/i)).not.toBeInTheDocument();
    expect(renderAsync).not.toHaveBeenCalled();
  });

  it('maps a race-time tooLarge read to the explicit state and reports its size', async () => {
    const onTooLarge = vi.fn();
    readBinaryFile.mockResolvedValueOnce({
      ok: false,
      error: 'tooLarge',
      size: OFFICE_MAX_BYTES + 17,
    });

    render(<DocxViewer filePath="/tmp/report.docx" onTooLarge={onTooLarge} />);

    expect(await screen.findByText(LOCALIZED_TOO_LARGE)).toBeVisible();
    expect(screen.queryByText(LOCALIZED_LOAD_FAILURE)).not.toBeInTheDocument();
    expect(onTooLarge).toHaveBeenCalledOnce();
    expect(onTooLarge).toHaveBeenCalledWith(OFFICE_MAX_BYTES + 17);
    expect(renderAsync).not.toHaveBeenCalled();
  });

  it('shows the localized generic failure when parsing fails without exposing the exception', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockRejectedValueOnce(new Error('confidential parser detail'));
    render(<DocxViewer filePath="/tmp/report.docx" />);

    expect(await screen.findByText(LOCALIZED_LOAD_FAILURE)).toBeVisible();
    expect(screen.queryByText(/confidential parser detail/i)).not.toBeInTheDocument();
  });

  it('clears generated detached DOM when unmounted during rendering', async () => {
    const pendingRender = deferred();
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    renderAsync.mockImplementationOnce(async (_bytes: Uint8Array, body: HTMLElement, styles: HTMLElement) => {
      await pendingRender.promise;
      appendRenderedPage(body);
      styles.append(styles.ownerDocument.createElement('style'));
    });
    const { unmount } = render(<DocxViewer filePath="/tmp/report.docx" />);
    await waitFor(() => expect(renderAsync).toHaveBeenCalledOnce());
    const host = screen.getByTestId('docx-preview-host');
    const shadowRoot = host.shadowRoot;
    const [, body, styles] = renderAsync.mock.calls[0] as [Uint8Array, HTMLElement, HTMLElement];

    unmount();
    await act(async () => pendingRender.resolve());

    expect(shadowRoot?.childNodes).toHaveLength(0);
    expect(body.childNodes).toHaveLength(0);
    expect(styles.childNodes).toHaveLength(0);
  });
});

describe('PptxViewer', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resizeObservers.length = 0;
    pptxInstances.length = 0;
    nextPptxSlideCount = 3;
    pptxRenderImplementation = undefined;
    createPptxViewer.mockImplementation(() => {
      const instance = {} as MockPptxViewer;
      instance.destroy = vi.fn();
      instance.getSlideCount = vi.fn(() => nextPptxSlideCount);
      instance.loadFile = vi.fn(async () => instance);
      instance.render = vi.fn(async (canvas: HTMLCanvasElement, options: { slideIndex: number }) => {
        await pptxRenderImplementation?.(instance, canvas, options);
        return instance;
      });
      pptxInstances.push(instance);
      return instance;
    });
    vi.stubGlobal('ResizeObserver', class {
      readonly record: ResizeObserverRecord;

      constructor(callback: ResizeObserverCallback) {
        this.record = {
          callback,
          disconnect: vi.fn(),
          observe: vi.fn(),
        };
        resizeObservers.push(this.record);
      }

      observe(target: Element) {
        this.record.observe(target);
      }

      unobserve() {}

      disconnect() {
        this.record.disconnect();
      }
    });
  });

  it.each([
    {
      name: 'ordinary local',
      props: { filePath: '/tmp/slides.pptx' } satisfies PptxViewerProps,
      arrange: () => readBinaryFile.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readBinaryFile).toHaveBeenCalledWith('/tmp/slides.pptx', { maxBytes: OFFICE_MAX_BYTES }),
    },
    {
      name: 'workspace-scoped',
      props: {
        filePath: 'slides.pptx',
        workspaceFileRef: { workspaceRoot: '/workspace', relativePath: 'slides.pptx' },
      } satisfies PptxViewerProps,
      arrange: () => readWorkspaceBinary.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readWorkspaceBinary).toHaveBeenCalledWith({
        workspaceRoot: '/workspace',
        relativePath: 'slides.pptx',
        maxBytes: OFFICE_MAX_BYTES,
      }),
    },
    {
      name: 'attachment-scoped',
      props: {
        filePath: 'slides.pptx',
        attachmentFileRef: {
          sessionKey: 'agent:main:session-1',
          generation: 4,
          uri: 'file:///private/slides.pptx',
        },
      } satisfies PptxViewerProps,
      arrange: () => readAttachmentBinary.mockResolvedValueOnce(successfulRead()),
      expected: () => expect(readAttachmentBinary).toHaveBeenCalledWith({
        sessionKey: 'agent:main:session-1',
        generation: 4,
        uri: 'file:///private/slides.pptx',
      }, OFFICE_MAX_BYTES),
    },
  ])('uses only the $name authorized binary route', async ({ arrange, expected, props }) => {
    arrange();
    await renderPptx(props);

    expected();
    expect(readBinaryFile.mock.calls.length + readWorkspaceBinary.mock.calls.length + readAttachmentBinary.mock.calls.length).toBe(1);
  });

  it('rejects simultaneous scoped references before reading or constructing', async () => {
    render(
      <PptxViewer
        filePath="slides.pptx"
        workspaceFileRef={{ workspaceRoot: '/workspace', relativePath: 'slides.pptx' }}
        attachmentFileRef={{
          sessionKey: 'agent:main:session-1',
          generation: 1,
          uri: 'file:///private/slides.pptx',
        }}
      />,
    );

    expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
    expect(readBinaryFile).not.toHaveBeenCalled();
    expect(readWorkspaceBinary).not.toHaveBeenCalled();
    expect(readAttachmentBinary).not.toHaveBeenCalled();
    expect(createPptxViewer).not.toHaveBeenCalled();
  });

  it('loads bytes with the safe fit options and renders slide zero at the positive CSS size', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead(7));
    const { canvas, instance } = await renderPptx();

    expect(createPptxViewer).toHaveBeenCalledWith({
      canvas,
      enableThumbnails: false,
      slideSizeMode: 'fit',
      backgroundColor: '#ffffff',
      autoChartRerenderDelayMs: 0,
    });
    expect(instance.loadFile).toHaveBeenCalledWith(Uint8Array.from([7]));
    expect(instance.render).toHaveBeenCalledWith(canvas, { slideIndex: 0 });
    expect(canvas.style.width).toBe('960px');
    expect(canvas.style.height).toBe('540px');
  });

  it.each([
    ['restores an in-range index', 1, 1],
    ['clamps an index above the deck', 99, 2],
    ['clamps a negative index', -8, 0],
  ])('%s after slide count is known', async (_name, initialSlideIndex, expectedIndex) => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const onSlideIndexChange = vi.fn();
    const { instance } = await renderPptx({
      filePath: '/tmp/slides.pptx',
      initialSlideIndex,
      onSlideIndexChange,
    });

    await waitFor(() => expect(screen.getByText(`${expectedIndex + 1} / 3`)).toBeVisible());
    expect(instance.getSlideCount).toHaveBeenCalled();
    expect(instance.render.mock.calls.map(([, options]) => options.slideIndex)).toEqual(
      expectedIndex === 0 ? [0] : [0, expectedIndex],
    );
    expect(onSlideIndexChange).toHaveBeenLastCalledWith(expectedIndex);
  });

  it('uses one-based controls, disables navigation during rendering, and publishes only successful navigation', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const onSlideIndexChange = vi.fn();
    await renderPptx({ filePath: '/tmp/slides.pptx', onSlideIndexChange });
    const previous = screen.getByRole('button', { name: 'Previous slide' });
    const next = screen.getByRole('button', { name: 'Next slide' });
    expect(screen.getByText('1 / 3')).toBeVisible();
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    const pendingNavigation = deferred();
    pptxRenderImplementation = async (_instance, _canvas, options) => {
      if (options.slideIndex === 1) await pendingNavigation.promise;
    };
    fireEvent.click(next);
    await waitFor(() => expect(pptxInstances[0].render).toHaveBeenCalledTimes(2));
    expect(previous).toBeDisabled();
    expect(next).toBeDisabled();
    expect(onSlideIndexChange).not.toHaveBeenCalledWith(1);

    await act(async () => pendingNavigation.resolve());
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeVisible());
    expect(previous).toBeEnabled();
    expect(next).toBeEnabled();
    expect(onSlideIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('serializes render sources and skips requests made obsolete before execution', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const onSlideIndexChange = vi.fn();
    const { container, instance } = await renderPptx({
      filePath: '/tmp/slides.pptx',
      onSlideIndexChange,
    });
    vi.useFakeTimers();
    const navigation = deferred();
    let concurrentRenders = 0;
    let maxConcurrentRenders = 0;
    pptxRenderImplementation = async (_viewer, _canvas, options) => {
      concurrentRenders += 1;
      maxConcurrentRenders = Math.max(maxConcurrentRenders, concurrentRenders);
      if (options.slideIndex === 1) await navigation.promise;
      concurrentRenders -= 1;
    };

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    await act(async () => Promise.resolve());
    expect(instance.render).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(instance.render).toHaveBeenCalledTimes(2);

    await act(async () => navigation.resolve());
    expect(instance.render).toHaveBeenCalledTimes(3);
    expect(maxConcurrentRenders).toBe(1);
    expect(instance.render.mock.calls[2][0]).toBe(screen.getByTestId('pptx-canvas'));
    expect(resizeObservers[0].observe).toHaveBeenCalledWith(container);
    expect(onSlideIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('terminates when a current-lifecycle render rejects after a newer request supersedes it', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const { instance } = await renderPptx();
    const pendingChartRender = deferred();
    let refreshRenderCount = 0;
    pptxRenderImplementation = async () => {
      refreshRenderCount += 1;
      if (refreshRenderCount === 1) await pendingChartRender.promise;
    };
    vi.useFakeTimers();

    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));
    await act(async () => Promise.resolve());
    expect(instance.render).toHaveBeenCalledTimes(2);

    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(instance.render).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    await act(async () => pendingChartRender.reject(new Error('superseded render failed')));

    expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
    await waitFor(() => expect(instance.destroy).toHaveBeenCalledOnce());
    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();

    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new CustomEvent('chartRenderingComplete'));
      resizeObservers[0].callback([], {} as ResizeObserver);
    });
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(screen.getByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
  });

  it('uses a 100 ms trailing resize debounce and applies the latest size', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const { canvas, instance } = await renderPptx();
    vi.useFakeTimers();
    setPptxSize(800, 450);
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    setPptxSize(640, 360);
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));

    await act(async () => vi.advanceTimersByTimeAsync(99));
    expect(instance.render).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(canvas.style.width).toBe('640px');
    expect(canvas.style.height).toBe('360px');
  });

  it('coalesces chart events during a refresh into one trailing render and removes the listener', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const { instance, unmount } = await renderPptx();
    const chartRender = deferred();
    pptxRenderImplementation = async () => chartRender.promise;

    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));
    await waitFor(() => expect(instance.render).toHaveBeenCalledTimes(2));
    act(() => {
      window.dispatchEvent(new CustomEvent('chartRenderingComplete'));
      window.dispatchEvent(new CustomEvent('chartRenderingComplete'));
    });
    expect(instance.render).toHaveBeenCalledTimes(2);

    await act(async () => chartRender.resolve());
    await waitFor(() => expect(instance.render).toHaveBeenCalledTimes(3));
    await act(async () => Promise.resolve());
    expect(instance.render).toHaveBeenCalledTimes(3);
    unmount();
    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));
    expect(instance.render).toHaveBeenCalledTimes(3);
  });

  it('does not load a replacement deck until the prior render and ordered teardown settle', async () => {
    readBinaryFile
      .mockResolvedValueOnce(successfulRead(1))
      .mockResolvedValueOnce(successfulRead(2));
    const firstRender = deferred();
    pptxRenderImplementation = async (instance) => {
      if (instance === pptxInstances[0]) await firstRender.promise;
    };
    const firstMount = render(<PptxViewer filePath="/tmp/first.pptx" />);
    setPptxSize();
    await waitFor(() => expect(pptxInstances[0]?.render).toHaveBeenCalledOnce());

    firstMount.unmount();
    render(<PptxViewer filePath="/tmp/second.pptx" />);
    setPptxSize(800, 450);
    await act(async () => Promise.resolve());
    expect(pptxInstances).toHaveLength(1);
    expect(pptxInstances[0].destroy).not.toHaveBeenCalled();

    await act(async () => firstRender.resolve());
    await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    await waitFor(() => expect(pptxInstances).toHaveLength(2));
    await waitFor(() => expect(pptxInstances[1].loadFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(pptxInstances[1].render).toHaveBeenCalledOnce());
    expect(pptxInstances[0].destroy.mock.invocationCallOrder[0]).toBeLessThan(
      pptxInstances[1].loadFile.mock.invocationCallOrder[0]!,
    );
  });

  it('ignores a rejected render from an obsolete target and keeps the replacement current', async () => {
    readBinaryFile
      .mockResolvedValueOnce(successfulRead(1))
      .mockResolvedValueOnce(successfulRead(2));
    const firstRender = deferred();
    const onSlideIndexChange = vi.fn();
    pptxRenderImplementation = async (instance) => {
      if (instance === pptxInstances[0]) await firstRender.promise;
    };
    const { rerender } = render(
      <PptxViewer filePath="/tmp/first.pptx" onSlideIndexChange={onSlideIndexChange} />,
    );
    const staleCanvas = setPptxSize().canvas;
    await waitFor(() => expect(pptxInstances[0]?.render).toHaveBeenCalledOnce());

    rerender(<PptxViewer filePath="/tmp/second.pptx" onSlideIndexChange={onSlideIndexChange} />);
    setPptxSize(800, 450);
    await act(async () => Promise.resolve());
    expect(pptxInstances).toHaveLength(1);
    await act(async () => firstRender.reject(new Error('obsolete render failed')));
    await waitFor(() => expect(pptxInstances).toHaveLength(2));
    await waitFor(() => expect(pptxInstances[1].render).toHaveBeenCalledOnce());

    await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    expect(staleCanvas.isConnected).toBe(false);
    expect(onSlideIndexChange).toHaveBeenCalledTimes(1);
    expect(onSlideIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('destroys exactly once and removes observers, timers, listeners, and Canvas on unmount', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const { canvas, instance, unmount } = await renderPptx();
    vi.useFakeTimers();
    act(() => resizeObservers[0].callback([], {} as ResizeObserver));
    unmount();
    await vi.advanceTimersByTimeAsync(100);
    await act(async () => Promise.resolve());
    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));

    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
    expect(instance.render).toHaveBeenCalledOnce();
    expect(canvas.isConnected).toBe(false);
  });

  it('asserts against a second development instance but tolerates Strict Mode cleanup', async () => {
    readBinaryFile.mockResolvedValue(successfulRead());
    const strictResult = render(
      <StrictMode>
        <PptxViewer filePath="/tmp/strict.pptx" />
      </StrictMode>,
    );
    setPptxSize();
    await waitFor(() => expect(pptxInstances.length).toBeGreaterThan(0));
    strictResult.unmount();

    expect(() => render(
      <>
        <PptxViewer filePath="/tmp/first.pptx" />
        <PptxViewer filePath="/tmp/second.pptx" />
      </>,
    )).toThrow(/single active instance/i);
  });

  it('bounds the positive-size wait before showing the localized failure', async () => {
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    readBinaryFile.mockResolvedValueOnce(successfulRead());

    const result = render(<PptxViewer filePath="/tmp/slides.pptx" />);
    try {
      for (let index = 0; index < 59; index += 1) {
        await waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(index));
        await act(async () => animationFrameCallbacks[index](index));
      }

      expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(59);
      expect(pptxInstances[0].render).not.toHaveBeenCalled();
      await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    } finally {
      result.unmount();
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it('does not publish a navigation index when its render fails', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    const onSlideIndexChange = vi.fn();
    await renderPptx({ filePath: '/tmp/slides.pptx', onSlideIndexChange });
    pptxRenderImplementation = async (_instance, _canvas, options) => {
      if (options.slideIndex === 1) throw new Error('private render detail');
    };

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));

    expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
    expect(onSlideIndexChange).not.toHaveBeenCalledWith(1);
    expect(screen.queryByText(/private render detail/i)).not.toBeInTheDocument();
    await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();

    const renderCount = pptxInstances[0].render.mock.calls.length;
    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new CustomEvent('chartRenderingComplete'));
      resizeObservers[0].callback([], {} as ResizeObserver);
    });
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(pptxInstances[0].render).toHaveBeenCalledTimes(renderCount);
    expect(screen.queryByText('2 / 3')).not.toBeInTheDocument();
  });

  it('terminates and disposes the lifecycle when the initial render fails', async () => {
    readBinaryFile.mockResolvedValueOnce(successfulRead());
    pptxRenderImplementation = async () => {
      throw new Error('private initial render detail');
    };

    render(<PptxViewer filePath="/tmp/slides.pptx" />);
    setPptxSize();

    expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
    await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    expect(resizeObservers).toHaveLength(0);
    act(() => window.dispatchEvent(new CustomEvent('chartRenderingComplete')));
    expect(pptxInstances[0].render).toHaveBeenCalledOnce();
  });

  it('maps a race-time tooLarge read to the explicit state without constructing a viewer', async () => {
    const onTooLarge = vi.fn();
    readBinaryFile.mockResolvedValueOnce({
      ok: false,
      error: 'tooLarge',
      size: OFFICE_MAX_BYTES + 31,
    });

    render(<PptxViewer filePath="/tmp/slides.pptx" onTooLarge={onTooLarge} />);
    setPptxSize();

    expect(await screen.findByText(LOCALIZED_TOO_LARGE)).toBeVisible();
    expect(screen.queryByText(LOCALIZED_PPTX_LOAD_FAILURE)).not.toBeInTheDocument();
    expect(onTooLarge).toHaveBeenCalledWith(OFFICE_MAX_BYTES + 31);
    expect(createPptxViewer).not.toHaveBeenCalled();
  });

  it.each([
    ['read rejection', () => readBinaryFile.mockRejectedValueOnce(new Error('private read detail'))],
    ['parser rejection', () => {
      readBinaryFile.mockResolvedValueOnce(successfulRead());
      createPptxViewer.mockImplementationOnce(() => {
        const instance = {
          destroy: vi.fn(),
          getSlideCount: vi.fn(() => 3),
          loadFile: vi.fn().mockRejectedValue(new Error('private parser detail')),
          render: vi.fn(),
        } as MockPptxViewer;
        pptxInstances.push(instance);
        return instance;
      });
    }],
  ])('shows a generic localized failure without raw exceptions for %s', async (_name, arrange) => {
    arrange();
    render(<PptxViewer filePath="/tmp/slides.pptx" />);
    setPptxSize();

    expect(await screen.findByText(LOCALIZED_PPTX_LOAD_FAILURE)).toBeVisible();
    expect(screen.queryByText(/private (read|parser) detail/i)).not.toBeInTheDocument();
    if (pptxInstances[0]) {
      await waitFor(() => expect(pptxInstances[0].destroy).toHaveBeenCalledOnce());
    }
  });
});
