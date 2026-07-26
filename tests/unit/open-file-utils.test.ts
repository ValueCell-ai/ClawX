import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmAndOpenFile, revealFile } from '@/components/file-preview/open-file-utils';

const mocks = vi.hoisted(() => ({
  message: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    dialog: { message: mocks.message },
    shell: {
      openPath: mocks.openPath,
      showItemInFolder: mocks.showItemInFolder,
    },
  },
}));

const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '';

describe('open-file-utils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.message.mockResolvedValue({ response: 1 });
  });

  it('retains trusted open and reveal behavior', async () => {
    mocks.openPath.mockResolvedValue('');

    await expect(confirmAndOpenFile({ filePath: '/tmp/demo.pdf', fileName: 'demo.pdf', t })).resolves.toBe(true);
    await revealFile({ filePath: '/tmp/demo.pdf' });

    expect(mocks.openPath).toHaveBeenCalledWith('/tmp/demo.pdf');
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/tmp/demo.pdf');
  });

});
