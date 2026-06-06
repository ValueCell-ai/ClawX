import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from '@/pages/Chat/copy-image';

const readBinaryFileMock = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readBinaryFile: (...args: unknown[]) => readBinaryFileMock(...args),
}));

describe('copyImageToClipboard', () => {
  beforeEach(() => {
    readBinaryFileMock.mockReset();
    class MockClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    Object.assign(globalThis, { ClipboardItem: MockClipboardItem });
    Object.assign(navigator, {
      clipboard: {
        write: vi.fn(async () => undefined),
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  it('copies image bytes from a data URL preview', async () => {
    const pngBytes = Uint8Array.from([137, 80, 78, 71]);
    const base64 = btoa(String.fromCharCode(...pngBytes));
    const preview = `data:image/png;base64,${base64}`;

    const ok = await copyImageToClipboard({
      preview,
      mimeType: 'image/png',
    });

    expect(ok).toBe(true);
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    expect(readBinaryFileMock).not.toHaveBeenCalled();
  });

  it('copies image bytes from a local file path', async () => {
    readBinaryFileMock.mockResolvedValueOnce({
      ok: true,
      data: Uint8Array.from([1, 2, 3]),
      mimeType: 'image/png',
    });

    const ok = await copyImageToClipboard({
      filePath: '/tmp/cat.png',
      mimeType: 'image/png',
    });

    expect(ok).toBe(true);
    expect(readBinaryFileMock).toHaveBeenCalledWith('/tmp/cat.png');
    expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
  });
});
