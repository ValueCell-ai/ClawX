import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createFromPathMock = vi.hoisted(() => vi.fn(() => ({
  isEmpty: () => true,
  getSize: () => ({ width: 1, height: 1 }),
  resize: vi.fn(),
  toPNG: vi.fn(),
})));

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
  nativeImage: {
    createFromPath: createFromPathMock,
  },
}));

describe('media api', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.resetModules();
    createFromPathMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-media-api-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns SVG thumbnails as original data URLs without nativeImage decoding', async () => {
    const svgPath = join(testDir, 'plan.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    await writeFile(svgPath, svg, 'utf8');

    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi();

    const result = await mediaApi.thumbnails({
      paths: [{ filePath: svgPath, mimeType: 'image/svg+xml' }],
    });

    expect(createFromPathMock).not.toHaveBeenCalled();
    expect(result[svgPath]).toEqual({
      preview: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      fileSize: Buffer.byteLength(svg),
    });
  });
});
