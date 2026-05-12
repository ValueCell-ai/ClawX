import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostApiContext } from '@electron/api/context';
import { handleSessionRoutes } from '@electron/api/routes/sessions';

const readFileMock = vi.fn();
const parseJsonBodyMock = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/mock/.openclaw',
}));

vi.mock('@electron/api/route-utils', async () => {
  const actual = await vi.importActual<typeof import('@electron/api/route-utils')>('@electron/api/route-utils');
  return {
    ...actual,
    parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  };
});

function createResponse() {
  const headers = new Map<string, string>();
  let body = '';
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
    end: (value: string) => {
      body = value;
    },
  } as unknown as ServerResponse;

  return {
    res,
    get json() {
      return JSON.parse(body) as { success: boolean; summaries?: Array<Record<string, unknown>> };
    },
    get statusCode() {
      return (res as ServerResponse).statusCode;
    },
  };
}

describe('POST /api/sessions/summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strips sender metadata and ignores internal untrusted injections when building titles', async () => {
    parseJsonBodyMock.mockResolvedValue({
      sessionKeys: ['agent:main:session-a'],
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/agents/main/sessions/sessions.json')) {
        return JSON.stringify({
          sessions: [
            { key: 'agent:main:session-a', file: 'session-a.jsonl' },
          ],
        });
      }
      if (path.endsWith('/agents/main/sessions/session-a.jsonl')) {
        return [
          JSON.stringify({
            type: 'message',
            message: {
              role: 'user',
              timestamp: 1700000000,
              content: 'System (untrusted): internal noise',
            },
          }),
          JSON.stringify({
            type: 'message',
            message: {
              role: 'user',
              timestamp: 1700000002,
              content: 'Sender (untrusted): Alice\n\nHello from Alice',
            },
          }),
        ].join('\n');
      }
      throw new Error(`Unexpected readFile path: ${path}`);
    });

    const response = createResponse();
    const handled = await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      response.res,
      new URL('http://127.0.0.1/api/sessions/summaries'),
      {} as HostApiContext,
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.json).toMatchObject({
      success: true,
      summaries: [
        {
          sessionKey: 'agent:main:session-a',
          firstUserText: 'Hello from Alice',
          lastTimestamp: 1700000002000,
        },
      ],
    });
  });

  it('drops sender json metadata blocks instead of using them as the label', async () => {
    parseJsonBodyMock.mockResolvedValue({
      sessionKeys: ['agent:main:session-json'],
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/agents/main/sessions/sessions.json')) {
        return JSON.stringify({
          sessions: [
            { key: 'agent:main:session-json', file: 'session-json.jsonl' },
          ],
        });
      }
      if (path.endsWith('/agents/main/sessions/session-json.jsonl')) {
        return [
          JSON.stringify({
            type: 'message',
            message: {
              role: 'user',
              timestamp: 1700000010,
              content: 'Sender (untrusted): ```json\n{"name":"Alice","id":"u1"}\n```\n\nActual user title',
            },
          }),
        ].join('\n');
      }
      throw new Error(`Unexpected readFile path: ${path}`);
    });

    const response = createResponse();
    await handleSessionRoutes(
      { method: 'POST' } as IncomingMessage,
      response.res,
      new URL('http://127.0.0.1/api/sessions/summaries'),
      {} as HostApiContext,
    );

    expect(response.json).toMatchObject({
      success: true,
      summaries: [
        {
          sessionKey: 'agent:main:session-json',
          firstUserText: 'Actual user title',
          lastTimestamp: 1700000010000,
        },
      ],
    });
  });
});
