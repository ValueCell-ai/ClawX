// @vitest-environment node

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
const createFromBufferMock = vi.hoisted(() => vi.fn(() => ({
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
    createFromBuffer: createFromBufferMock,
  },
}));

describe('media api', () => {
  let testDir: string;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    createFromPathMock.mockClear();
    createFromBufferMock.mockClear();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-media-api-'));
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = testDir;
  });

  afterEach(async () => {
    if (previousStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previousStateDir;
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

  it('revalidates attachment thumbnails through attachment access and keys by opaque identity', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path /></svg>';
    const attachmentFileRef = {
      sessionKey: 'agent:main:session-a',
      generation: 3,
      uri: 'file:///private/media/generated.svg',
    };
    const readAttachmentBinary = vi.fn().mockResolvedValue({
      ok: true,
      data: new Uint8Array(Buffer.from(svg)),
      mimeType: 'image/svg+xml',
      size: Buffer.byteLength(svg),
    });
    const opaqueKey = 'a'.repeat(64);
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      identity: opaqueKey,
      displayName: 'generated.svg',
      mimeType: 'image/svg+xml',
      size: Buffer.byteLength(svg),
      target: { kind: 'local', scope: 'openclaw-media', ref: attachmentFileRef },
    });
    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi({
      attachmentAccess: { resolveAttachment, readAttachmentBinary } as never,
    });

    const result = await mediaApi.thumbnails({
      paths: [{ attachmentFileRef, key: opaqueKey, mimeType: 'image/svg+xml' }],
    });

    expect(resolveAttachment).toHaveBeenCalledWith({ ref: attachmentFileRef });
    expect(readAttachmentBinary).toHaveBeenCalledWith({ ref: attachmentFileRef });
    expect(result[opaqueKey]).toEqual({
      preview: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      fileSize: Buffer.byteLength(svg),
    });
    expect(result).not.toHaveProperty(attachmentFileRef.uri);
    expect(createFromPathMock).not.toHaveBeenCalled();
  });

  it('rejects attachment thumbnail keys that were not issued by Main', async () => {
    const readAttachmentBinary = vi.fn();
    const resolveAttachment = vi.fn();
    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi({
      attachmentAccess: { resolveAttachment, readAttachmentBinary } as never,
    });

    const result = await mediaApi.thumbnails({
      paths: [{
        attachmentFileRef: {
          sessionKey: 'agent:main:session-a',
          generation: 3,
          uri: 'file:///private/media/generated.svg',
        },
        key: '__proto__',
        mimeType: 'image/svg+xml',
      }],
    });

    expect(readAttachmentBinary).not.toHaveBeenCalled();
    expect(resolveAttachment).not.toHaveBeenCalled();
    expect(Object.keys(result)).toEqual([]);
  });

  it('rejects a valid-looking thumbnail key that does not match Main resolution', async () => {
    const attachmentFileRef = {
      sessionKey: 'agent:main:session-a',
      generation: 3,
      uri: 'file:///private/media/generated.svg',
    };
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      identity: 'a'.repeat(64),
      displayName: 'generated.svg',
      mimeType: 'image/svg+xml',
      size: 10,
      target: { kind: 'local', scope: 'openclaw-media', ref: attachmentFileRef },
    });
    const readAttachmentBinary = vi.fn();
    const { createMediaApi } = await import('../../electron/services/media-api');
    const mediaApi = createMediaApi({
      attachmentAccess: { resolveAttachment, readAttachmentBinary } as never,
    });

    const result = await mediaApi.thumbnails({
      paths: [{ attachmentFileRef, key: 'b'.repeat(64), mimeType: 'image/svg+xml' }],
    });

    expect(resolveAttachment).toHaveBeenCalledWith({ ref: attachmentFileRef });
    expect(readAttachmentBinary).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('keeps legacy outgoing thumbnails while enforcing URL and record session equality', async () => {
    const attachmentId = 'generated-image';
    const sessionKey = 'agent:main:session-a';
    const originalPath = join(testDir, 'media', 'outgoing', 'originals', 'image.png');
    const recordsDir = join(testDir, 'media', 'outgoing', 'records');
    await mkdir(join(testDir, 'media', 'outgoing', 'originals'), { recursive: true });
    await mkdir(recordsDir, { recursive: true });
    await writeFile(originalPath, 'image bytes');
    await writeFile(join(recordsDir, `${attachmentId}.json`), JSON.stringify({
      attachmentId,
      sessionKey,
      original: { path: originalPath, contentType: 'image/png' },
    }));
    const gatewayUrl = `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${attachmentId}/full`;
    const mismatchUrl = `/api/chat/media/outgoing/${encodeURIComponent('agent:main:other')}/${attachmentId}/full`;
    const { createMediaApi } = await import('../../electron/services/media-api');

    const result = await createMediaApi().thumbnails({
      paths: [
        { gatewayUrl, mimeType: 'image/png' },
        { gatewayUrl: mismatchUrl, mimeType: 'image/png' },
      ],
    });

    expect(result[gatewayUrl]).toEqual({ preview: null, fileSize: 11 });
    expect(result[mismatchUrl]).toEqual({ preview: null, fileSize: 0 });
  });
});
