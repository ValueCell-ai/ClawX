import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const createFromPathMock = vi.hoisted(() => vi.fn(() => ({
  isEmpty: () => true,
  getSize: () => ({ width: 1, height: 1 }),
  resize: vi.fn(),
  toPNG: vi.fn(),
})));

const userDataPath = join(tmpdir(), 'clawx-files-api-user-data');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataPath),
  },
  nativeImage: {
    createFromPath: createFromPathMock,
  },
}));

describe('files api', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.resetModules();
    createFromPathMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-files-api-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('preserves the original filename in staged file paths for history echo', async () => {
    const sourcePath = join(testDir, 'manual attachment.txt');
    await writeFile(sourcePath, 'hello from staged file', 'utf8');

    const { createFilesApi } = await import('../../electron/services/files-api');
    const filesApi = createFilesApi();

    const [result] = await filesApi.stagePaths({ filePaths: [sourcePath] });

    expect(result.fileName).toBe('manual attachment.txt');
    expect(basename(result.stagedPath)).toMatch(/manual_attachment\.txt$/);
  });

  it('preserves the original buffer filename in staged file paths for history echo', async () => {
    const { createFilesApi } = await import('../../electron/services/files-api');
    const filesApi = createFilesApi();

    const result = await filesApi.stageBuffer({
      fileName: 'screen shot.png',
      mimeType: 'image/png',
      base64: Buffer.from('fake image bytes').toString('base64'),
    });

    expect(result.fileName).toBe('screen shot.png');
    expect(basename(result.stagedPath)).toMatch(/screen_shot\.png$/);
  });
});
