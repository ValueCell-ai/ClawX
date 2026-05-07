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

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpc(...args),
  readTextFile: vi.fn(),
  statFile: vi.fn(),
  writeTextFile: vi.fn(),
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
  it('uses known attachment size to show direct-open fallback for large PDFs', async () => {
    render(
      <FilePreviewBody
        file={makePreviewTarget()}
        mode="preview"
      />,
    );

    const openButton = await screen.findByRole('button', { name: '直接打开' });
    expect(openButton).toBeVisible();

    fireEvent.click(openButton);

    await waitFor(() => {
      expect(invokeIpc).toHaveBeenCalledWith('dialog:message', expect.objectContaining({
        buttons: expect.arrayContaining(['直接打开']),
      }));
      expect(invokeIpc).toHaveBeenCalledWith('shell:openPath', '/tmp/large-report.pdf');
    });
  });
});
