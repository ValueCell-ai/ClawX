/**
 * Unit tests for /api/files/stage-paths.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, rmSync } from 'node:fs';
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
});
