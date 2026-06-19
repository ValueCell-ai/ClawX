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

vi.mock('../../electron/utils/openclaw-image-generation', () => ({
  applyOpenAiImageRelaySettings: vi.fn(),
  getImageGenerationSettingsSnapshot: vi.fn(async () => ({
    config: { primary: null, fallbacks: [], timeoutMs: null },
    openAiRelay: { enabled: false, baseUrl: null, model: '', hasApiKey: false },
  })),
  listImageGenerationProvidersFromRuntime: vi.fn(async () => []),
  runImageGenerationTest: vi.fn(async () => ({ success: true })),
  setImageGenerationConfig: vi.fn(async (config) => config),
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

  it('falls back to the original image bytes when nativeImage cannot decode a valid image', async () => {
    const imagePath = join(testDir, 'tiny.png');
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await writeFile(imagePath, imageBytes);

    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi();

    const result = await mediaApi.thumbnails({
      paths: [{ filePath: imagePath, mimeType: 'image/png' }],
    });

    expect(createFromPathMock).toHaveBeenCalledWith(imagePath);
    expect(result[imagePath]).toEqual({
      preview: `data:image/png;base64,${imageBytes.toString('base64')}`,
      fileSize: imageBytes.length,
    });
  });
});
