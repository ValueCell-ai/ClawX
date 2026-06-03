/**
 * Unit tests for /api/files/stage-paths.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sendJsonMock = vi.fn();
const parseJsonBodyMock = vi.fn();

const testRootDir = join(tmpdir(), 'clawx-tests', 'files-routes');

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

function resetFixtures(): void {
  rmSync(testRootDir, { recursive: true, force: true });
  mkdirSync(testRootDir, { recursive: true });
}

function makeReq(method = 'POST'): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

const STAGE_PATHS_URL = new URL('http://127.0.0.1:13210/api/files/stage-paths');
const THUMBNAILS_URL = new URL('http://127.0.0.1:13210/api/files/thumbnails');
const ctx = {} as never;

describe('handleFileRoutes — POST /api/files/stage-paths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetFixtures();
  });

  afterAll(() => {
    rmSync(testRootDir, { recursive: true, force: true });
  });

  it('returns directory metadata without copying the folder', async () => {
    const folderPath = join(testRootDir, 'project-folder');
    mkdirSync(folderPath);

    parseJsonBodyMock.mockResolvedValueOnce({ filePaths: [folderPath] });

    const { handleFileRoutes } = await import('@electron/api/routes/files');
    const handled = await handleFileRoutes(makeReq(), makeRes(), STAGE_PATHS_URL, ctx);

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    const [, status, payload] = sendJsonMock.mock.calls[0] as [ServerResponse, number, Array<Record<string, unknown>>];
    expect(status).toBe(200);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      fileName: 'project-folder',
      mimeType: 'application/x-directory',
      fileSize: 0,
      stagedPath: folderPath,
      preview: null,
    });
  });

  it('returns SVG previews as data URLs from thumbnails', async () => {
    const svgPath = join(testRootDir, 'plan.svg');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    writeFileSync(svgPath, svg);

    parseJsonBodyMock.mockResolvedValueOnce({
      paths: [{ filePath: svgPath, mimeType: 'image/svg+xml' }],
    });

    const { handleFileRoutes } = await import('@electron/api/routes/files');
    const handled = await handleFileRoutes(makeReq(), makeRes(), THUMBNAILS_URL, ctx);

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledTimes(1);
    const [, status, payload] = sendJsonMock.mock.calls[0] as [
      ServerResponse,
      number,
      Record<string, { preview: string | null; fileSize: number }>,
    ];
    expect(status).toBe(200);
    expect(payload[svgPath]).toEqual({
      preview: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      fileSize: Buffer.byteLength(svg),
    });
  });
});
