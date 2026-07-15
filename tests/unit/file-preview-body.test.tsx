import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilePreviewBody } from '@/components/file-preview/FilePreviewBody';
import type { FilePreviewTarget } from '@/components/file-preview/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? ''
    ),
  }),
}));

const dialogMessageMock = vi.fn(async () => ({ response: 1 }));
const shellOpenPathMock = vi.fn(async () => '');
const shellShowItemInFolderMock = vi.fn(async () => undefined);
const readTextFile = vi.fn();
const readWorkspaceText = vi.fn();
const readAttachmentText = vi.fn();
const statFile = vi.fn();
const statWorkspaceFile = vi.fn();
const writeTextFile = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  readWorkspaceText: (...args: unknown[]) => readWorkspaceText(...args),
  readAttachmentText: (...args: unknown[]) => readAttachmentText(...args),
  statFile: (...args: unknown[]) => statFile(...args),
  statWorkspaceFile: (...args: unknown[]) => statWorkspaceFile(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    dialog: {
      message: (...args: unknown[]) => dialogMessageMock(...args),
    },
    shell: {
      openPath: (...args: unknown[]) => shellOpenPathMock(...args),
      showItemInFolder: (...args: unknown[]) => shellShowItemInFolderMock(...args),
    },
  },
}));

function makePreviewTarget(overrides: Partial<FilePreviewTarget> = {}): FilePreviewTarget {
  return {
    filePath: '/tmp/large-report.pdf',
    fileName: 'large-report.pdf',
    ext: '.pdf',
    mimeType: 'application/pdf',
    contentType: 'document',
    size: 51 * 1024 * 1024,
    ...overrides,
  };
}

describe('FilePreviewBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders html files as sandboxed HTML preview instead of raw source by default', async () => {
    readTextFile.mockResolvedValueOnce({
      ok: true,
      content: '<!doctype html><html><body><h1>Rendered HTML</h1><script>document.body.dataset.scriptRan = "yes";</script></body></html>',
      size: 121,
      readOnly: true,
    });

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: '/tmp/demo.html',
          fileName: 'demo.html',
          ext: '.html',
          mimeType: 'text/html',
          contentType: 'document',
          size: 121,
        })}
        mode="preview"
      />,
    );

    const frame = await screen.findByTestId('html-preview-frame');
    expect(frame).toBeVisible();
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads',
    );
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
  });

  it('uses attachment-scoped text reads for HTML without a naked-path fallback', async () => {
    const attachmentFileRef = { sessionKey: 'agent:main:s1', generation: 4, uri: 'file:///secret/site.html' };
    readAttachmentText.mockResolvedValueOnce({
      ok: true,
      content: '<h1>Scoped HTML</h1>',
      mimeType: 'text/html',
      size: 20,
      readOnly: true,
    });

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'site.html',
          fileName: 'site.html',
          ext: '.html',
          mimeType: 'text/html',
          contentType: 'document',
          size: 20,
          attachmentFileRef,
        })}
        mode="preview"
      />,
    );

    expect(await screen.findByTestId('html-preview-frame')).toHaveAttribute('srcdoc', '<h1>Scoped HTML</h1>');
    expect(readAttachmentText).toHaveBeenCalledWith(attachmentFileRef);
    expect(readWorkspaceText).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Show in file manager' })).not.toBeInTheDocument();
  });

  it('uses attachment-scoped text reads for source previews without workspace fallback', async () => {
    const attachmentFileRef = { sessionKey: 'agent:main:s1', generation: 4, uri: 'file:///secret/demo.ts' };
    readAttachmentText.mockResolvedValueOnce({
      ok: true,
      content: 'export const scoped = true;',
      mimeType: 'text/typescript',
      size: 27,
      readOnly: true,
    });

    render(<FilePreviewBody file={makePreviewTarget({
      filePath: 'demo.ts', fileName: 'demo.ts', ext: '.ts', mimeType: 'text/typescript', contentType: 'code', size: 27, attachmentFileRef,
    })} />);

    await waitFor(() => expect(readAttachmentText).toHaveBeenCalledWith(attachmentFileRef));
    expect(readWorkspaceText).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('uses known attachment size to show direct-open fallback for large PDFs', async () => {
    render(
      <FilePreviewBody
        file={makePreviewTarget()}
        mode="preview"
      />,
    );

    const openButton = await screen.findByRole('button', { name: 'Open directly' });
    expect(openButton).toBeVisible();

    fireEvent.click(openButton);

    await waitFor(() => {
      expect(dialogMessageMock).toHaveBeenCalledWith(expect.objectContaining({
        buttons: expect.arrayContaining(['Open directly']),
      }));
      expect(shellOpenPathMock).toHaveBeenCalledWith('/tmp/large-report.pdf');
    });
  });

  it('uses scoped text reads and stays read-only for workspace targets', async () => {
    const workspaceFileRef = { workspaceRoot: '/workspace', relativePath: 'src/demo.ts' };
    readWorkspaceText.mockResolvedValueOnce({
      ok: true,
      content: 'const scoped = true;',
      size: 20,
      readOnly: false,
    });

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'src/demo.ts',
          fileName: 'demo.ts',
          ext: '.ts',
          mimeType: 'text/typescript',
          contentType: 'code',
          size: undefined,
          workspaceFileRef,
        })}
      />,
    );

    await waitFor(() => expect(readWorkspaceText).toHaveBeenCalledWith(workspaceFileRef));
    expect(readTextFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
  });

  it('uses only scoped stat for rich workspace targets after errors', async () => {
    const workspaceFileRef = { workspaceRoot: '/workspace', relativePath: 'reports/demo.pdf' };
    statWorkspaceFile.mockRejectedValueOnce(new Error('denied'));

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'reports/demo.pdf',
          size: undefined,
          workspaceFileRef,
        })}
        mode="preview"
      />,
    );

    await waitFor(() => expect(statWorkspaceFile).toHaveBeenCalledWith(workspaceFileRef));
    expect(statFile).not.toHaveBeenCalled();
  });

  it('renders no system open or reveal action for scoped read errors', async () => {
    const workspaceFileRef = { workspaceRoot: '/workspace', relativePath: 'src/missing.ts' };
    readWorkspaceText.mockResolvedValueOnce({ ok: false, error: 'notFound' });

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'src/missing.ts',
          fileName: 'missing.ts',
          ext: '.ts',
          mimeType: 'text/typescript',
          contentType: 'code',
          size: undefined,
          workspaceFileRef,
        })}
      />,
    );

    expect(await screen.findByText('File not found')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show in file manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open directly' })).not.toBeInTheDocument();
    expect(shellShowItemInFolderMock).not.toHaveBeenCalled();
    expect(shellOpenPathMock).not.toHaveBeenCalled();
    expect(dialogMessageMock).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('renders no direct-open fallback for scoped oversized rich files', async () => {
    const workspaceFileRef = { workspaceRoot: '/workspace', relativePath: 'reports/large.pdf' };

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'reports/large.pdf',
          workspaceFileRef,
        })}
        mode="preview"
      />,
    );

    expect(await screen.findByText('File is too large ({{size}}); preview disabled')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open directly' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in file manager' })).not.toBeInTheDocument();
    expect(dialogMessageMock).not.toHaveBeenCalled();
    expect(shellOpenPathMock).not.toHaveBeenCalled();
    expect(shellShowItemInFolderMock).not.toHaveBeenCalled();
  });

  it('renders no system action fallback for scoped unsupported files', async () => {
    statWorkspaceFile.mockResolvedValueOnce({ ok: true, size: 1024, isFile: true });

    render(
      <FilePreviewBody
        file={makePreviewTarget({
          filePath: 'artifacts/archive.zip',
          fileName: 'archive.zip',
          ext: '.zip',
          mimeType: 'application/zip',
          size: 1024,
          workspaceFileRef: { workspaceRoot: '/workspace', relativePath: 'artifacts/archive.zip' },
        })}
        mode="preview"
      />,
    );

    expect(await screen.findByText('This file format is not supported for inline preview or diff')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open directly' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show in file manager' })).not.toBeInTheDocument();
    expect(dialogMessageMock).not.toHaveBeenCalled();
    expect(shellOpenPathMock).not.toHaveBeenCalled();
    expect(shellShowItemInFolderMock).not.toHaveBeenCalled();
  });

  it('does not keep text from another workspace current while the replacement read is pending', async () => {
    const nextRead = new Promise<never>(() => undefined);
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'site/index.html' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'site/index.html' };
    readWorkspaceText
      .mockResolvedValueOnce({ ok: true, content: '<p>workspace-a</p>', readOnly: true })
      .mockReturnValueOnce(nextRead);
    const makeHtmlTarget = (workspaceFileRef: typeof firstRef) => makePreviewTarget({
      filePath: 'site/index.html',
      fileName: 'index.html',
      ext: '.html',
      mimeType: 'text/html',
      contentType: 'document',
      size: undefined,
      workspaceFileRef,
    });

    const { rerender } = render(<FilePreviewBody file={makeHtmlTarget(firstRef)} mode="preview" />);
    expect(await screen.findByTestId('html-preview-frame')).toHaveAttribute(
      'srcdoc',
      '<p>workspace-a</p>',
    );

    rerender(<FilePreviewBody file={makeHtmlTarget(secondRef)} mode="preview" />);

    expect(screen.queryByTestId('html-preview-frame')).not.toBeInTheDocument();
    expect(readWorkspaceText).toHaveBeenLastCalledWith(secondRef);
  });
});
