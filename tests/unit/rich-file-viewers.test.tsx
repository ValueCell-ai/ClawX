import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PdfViewer from '@/components/file-preview/PdfViewer';
import SheetViewer from '@/components/file-preview/SheetViewer';
import ImageViewer from '@/components/file-preview/ImageViewer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; error?: string }) => {
      if (typeof options === 'string') return options;
      return (options?.defaultValue ?? '').replace('{{error}}', options?.error ?? '');
    },
  }),
}));

const readBinaryFile = vi.fn();
const readWorkspaceBinary = vi.fn();
const readAttachmentBinary = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: (...args: unknown[]) => readBinaryFile(...args),
  readWorkspaceBinary: (...args: unknown[]) => readWorkspaceBinary(...args),
  readAttachmentBinary: (...args: unknown[]) => readAttachmentBinary(...args),
}));

vi.mock('xlsx', () => ({
  read: (data: Uint8Array) => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: { value: data[0] === 1 ? 'workspace-a' : 'workspace-b' } },
  }),
  utils: {
    sheet_to_json: (sheet: { value: string }) => [[sheet.value]],
  },
}));

const ref = { workspaceRoot: '/workspace', relativePath: 'reports/file.pdf' };

describe('rich file viewers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retains unscoped PDF and sheet binary routing for trusted paths', async () => {
    readBinaryFile
      .mockResolvedValueOnce({ ok: false, error: 'notFound' })
      .mockResolvedValueOnce({ ok: false, error: 'notFound' });

    render(
      <>
        <PdfViewer filePath="/tmp/file.pdf" />
        <SheetViewer filePath="/tmp/file.xlsx" />
      </>,
    );

    expect(await screen.findByText('PDF failed to load: notFound')).toBeVisible();
    expect(await screen.findByText('Spreadsheet failed to load: notFound')).toBeVisible();
    expect(readBinaryFile).toHaveBeenCalledWith('/tmp/file.pdf', { maxBytes: 50 * 1024 * 1024 });
    expect(readBinaryFile).toHaveBeenCalledWith('/tmp/file.xlsx', { maxBytes: 50 * 1024 * 1024 });
    expect(readWorkspaceBinary).not.toHaveBeenCalled();
  });

  it('routes scoped PDF failures without an unscoped retry', async () => {
    readWorkspaceBinary.mockResolvedValueOnce({ ok: false, error: 'outsideSandbox' });
    render(<PdfViewer filePath="reports/file.pdf" workspaceFileRef={ref} />);

    expect(await screen.findByText('PDF failed to load: outsideSandbox')).toBeVisible();
    expect(readWorkspaceBinary).toHaveBeenCalledWith({ ...ref, maxBytes: 50 * 1024 * 1024 });
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it('routes scoped sheet failures without an unscoped retry', async () => {
    const sheetRef = { ...ref, relativePath: 'reports/file.xlsx' };
    readWorkspaceBinary.mockResolvedValueOnce({ ok: false, error: 'notFound' });
    render(<SheetViewer filePath="reports/file.xlsx" workspaceFileRef={sheetRef} />);

    expect(await screen.findByText('Spreadsheet failed to load: notFound')).toBeVisible();
    expect(readWorkspaceBinary).toHaveBeenCalledWith({ ...sheetRef, maxBytes: 50 * 1024 * 1024 });
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it.each([
    ['image', 'image.png'],
    ['PDF', 'file.pdf'],
    ['sheet', 'file.xlsx'],
  ])('routes attachment-scoped %s failures without workspace or naked-path retries', async (kind, fileName) => {
    const attachmentFileRef = { sessionKey: 'agent:main:s1', generation: 2, uri: `file:///secret/${fileName}` };
    readAttachmentBinary.mockResolvedValueOnce({ ok: false, error: 'operationFailed' });

    if (kind === 'image') {
      render(<ImageViewer filePath={fileName} fileName={fileName} attachmentFileRef={attachmentFileRef} />);
      expect(await screen.findByText('Image failed to load: operationFailed')).toBeVisible();
    } else if (kind === 'PDF') {
      render(<PdfViewer filePath={fileName} fileName={fileName} attachmentFileRef={attachmentFileRef} />);
      expect(await screen.findByText('PDF failed to load: operationFailed')).toBeVisible();
    } else {
      render(<SheetViewer filePath={fileName} fileName={fileName} attachmentFileRef={attachmentFileRef} />);
      expect(await screen.findByText('Spreadsheet failed to load: operationFailed')).toBeVisible();
    }

    expect(readAttachmentBinary).toHaveBeenCalledWith(attachmentFileRef, 50 * 1024 * 1024);
    expect(readWorkspaceBinary).not.toHaveBeenCalled();
    expect(readBinaryFile).not.toHaveBeenCalled();
  });

  it('does not keep a PDF blob from another workspace current while the replacement read is pending', async () => {
    const nextRead = new Promise<never>(() => undefined);
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'reports/file.pdf' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'reports/file.pdf' };
    readWorkspaceBinary
      .mockResolvedValueOnce({ ok: true, data: Uint8Array.from([1]) })
      .mockReturnValueOnce(nextRead);

    const { rerender } = render(<PdfViewer filePath="reports/file.pdf" workspaceFileRef={firstRef} />);
    expect(await screen.findByTitle('PDF preview')).toBeInTheDocument();

    rerender(<PdfViewer filePath="reports/file.pdf" workspaceFileRef={secondRef} />);

    expect(screen.queryByTitle('PDF preview')).not.toBeInTheDocument();
    expect(readWorkspaceBinary).toHaveBeenLastCalledWith({ ...secondRef, maxBytes: 50 * 1024 * 1024 });
  });

  it('does not keep a sheet from another workspace current while the replacement read is pending', async () => {
    const nextRead = new Promise<never>(() => undefined);
    const firstRef = { workspaceRoot: '/workspace-a', relativePath: 'reports/file.xlsx' };
    const secondRef = { workspaceRoot: '/workspace-b', relativePath: 'reports/file.xlsx' };
    readWorkspaceBinary
      .mockResolvedValueOnce({ ok: true, data: Uint8Array.from([1]) })
      .mockReturnValueOnce(nextRead);

    const { rerender } = render(<SheetViewer filePath="reports/file.xlsx" workspaceFileRef={firstRef} />);
    expect(await screen.findByText('workspace-a')).toBeVisible();

    rerender(<SheetViewer filePath="reports/file.xlsx" workspaceFileRef={secondRef} />);

    expect(screen.queryByText('workspace-a')).not.toBeInTheDocument();
    expect(readWorkspaceBinary).toHaveBeenLastCalledWith({ ...secondRef, maxBytes: 50 * 1024 * 1024 });
  });
});
