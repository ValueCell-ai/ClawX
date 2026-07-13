import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createFromPathMock = vi.hoisted(() => vi.fn(() => ({
  isEmpty: () => true,
  getSize: () => ({ width: 1, height: 1 }),
  resize: vi.fn(),
  toPNG: vi.fn(),
})));
const appGetPathMock = vi.hoisted(() => vi.fn((name: string) => {
  if (name === 'userData') return '/tmp/clawx-user-data';
  return '/tmp';
}));

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
    isPackaged: false,
  },
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
    appGetPathMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-media-api-'));
    appGetPathMock.mockImplementation((name: string) => {
      if (name === 'userData') return join(testDir, 'userData');
      return testDir;
    });
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

  it('resolves outgoing gateway media through the active cc-connect media records', async () => {
    const sourcePath = join(testDir, 'artifact.txt');
    await writeFile(sourcePath, 'generated artifact', 'utf8');
    const recordDir = join(testDir, 'userData', 'runtimes', 'cc-connect', 'media', 'outgoing', 'records');
    await mkdir(recordDir, { recursive: true });
    await writeFile(
      join(recordDir, 'artifact-1.json'),
      JSON.stringify({
        original: {
          path: sourcePath,
          contentType: 'text/plain',
        },
      }),
      'utf8',
    );

    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi({
      runtimeManager: {
        getStatus: () => ({ runtimeKind: 'cc-connect' }),
      },
    });
    const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3As-1/artifact-1/full';

    const result = await mediaApi.thumbnails({
      paths: [{ gatewayUrl, mimeType: 'text/plain' }],
    });

    expect(result[gatewayUrl]).toEqual({
      preview: null,
      fileSize: Buffer.byteLength('generated artifact'),
    });
  });
});
