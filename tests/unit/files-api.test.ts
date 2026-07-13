import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const appGetPathMock = vi.hoisted(() => vi.fn((name: string) => {
  if (name === 'userData') return '/tmp/clawx-user-data';
  return '/tmp';
}));

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
    isPackaged: false,
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 1, height: 1 }),
      resize: vi.fn(),
      toPNG: vi.fn(),
    })),
  },
}));

describe('files api', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.resetModules();
    appGetPathMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-files-api-'));
    appGetPathMock.mockImplementation((name: string) => {
      if (name === 'userData') return join(testDir, 'userData');
      return testDir;
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('stages pasted buffers under the cc-connect managed media root when cc-connect is active', async () => {
    const { createFilesApi } = await import('../../electron/services/files-api');
    const filesApi = createFilesApi({
      runtimeManager: {
        getStatus: () => ({ runtimeKind: 'cc-connect' }),
      },
    });
    const payload = Buffer.from('hello cc-connect media').toString('base64');

    const staged = await filesApi.stageBuffer({
      base64: payload,
      fileName: 'note.txt',
      mimeType: 'text/plain',
    });

    expect(staged.stagedPath).toContain(join('userData', 'runtimes', 'cc-connect', 'media', 'outbound'));
    await expect(readFile(staged.stagedPath, 'utf8')).resolves.toBe('hello cc-connect media');
  });
});
