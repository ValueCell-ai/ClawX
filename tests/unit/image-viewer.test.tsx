import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ImageViewer from '@/components/file-preview/ImageViewer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string; error?: string }) => {
      if (typeof options === 'string') return options;
      if (options?.defaultValue && options.error) {
        return options.defaultValue.replace('{{error}}', options.error);
      }
      return options?.defaultValue ?? '';
    },
  }),
}));

const readBinaryFile = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: (...args: unknown[]) => readBinaryFile(...args),
}));

describe('ImageViewer', () => {
  it('loads image bytes via IPC and renders a blob URL preview', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    readBinaryFile.mockResolvedValueOnce({
      ok: true,
      data: pngBytes,
      mimeType: 'image/png',
      size: pngBytes.length,
      readOnly: true,
    });

    render(<ImageViewer filePath="/tmp/demo.png" fileName="demo.png" />);

    await waitFor(() => {
      expect(screen.getByTestId('image-preview')).toBeVisible();
    });

    const img = screen.getByTestId('image-preview') as HTMLImageElement;
    expect(img.src).toMatch(/^blob:/);
    expect(readBinaryFile).toHaveBeenCalledWith('/tmp/demo.png', { maxBytes: 50 * 1024 * 1024 });
  });

  it('shows an error when binary read fails', async () => {
    readBinaryFile.mockResolvedValueOnce({
      ok: false,
      error: 'notFound',
    });

    render(<ImageViewer filePath="/tmp/missing.png" fileName="missing.png" />);

    await waitFor(() => {
      expect(screen.getByText('Image failed to load: notFound')).toBeVisible();
    });
  });
});
