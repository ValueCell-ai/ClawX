import { describe, expect, it, vi } from 'vitest';
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

const invokeIpc = vi.fn(async (channel: string) => {
  if (channel === 'dialog:message') return { response: 1 };
  if (channel === 'shell:openPath') return '';
  return {};
});
const readTextFile = vi.fn();
const statFile = vi.fn();
const writeTextFile = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpc(...args),
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  statFile: (...args: unknown[]) => statFile(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
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
      expect(invokeIpc).toHaveBeenCalledWith('dialog:message', expect.objectContaining({
        buttons: expect.arrayContaining(['Open directly']),
      }));
      expect(invokeIpc).toHaveBeenCalledWith('shell:openPath', '/tmp/large-report.pdf');
    });
  });
});
