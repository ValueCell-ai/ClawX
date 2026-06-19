import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  gateway: {
    rpc: vi.fn(),
  },
  chat: {
    sendWithMedia: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

describe('createClawXChatCoreClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes generic RPCs through hostApi.gateway.rpc', async () => {
    hostApiMock.gateway.rpc.mockResolvedValueOnce({ messages: [] });
    const { createClawXChatCoreClient } = await import('@/chat-core/clawx-adapter/client');
    const client = createClawXChatCoreClient();

    const result = await client.request('chat.history', { sessionKey: 'agent:main:main' }, 5000);

    expect(result).toEqual({ messages: [] });
    expect(hostApiMock.gateway.rpc).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:main:main' },
      5000,
    );
  });

  it('routes media sends through hostApi.chat.sendWithMedia when staged files are present', async () => {
    hostApiMock.chat.sendWithMedia.mockResolvedValueOnce({
      success: true,
      result: { runId: 'run-1' },
    });
    const { createClawXChatCoreClient } = await import('@/chat-core/clawx-adapter/client');
    const client = createClawXChatCoreClient();

    const result = await client.request('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'describe this',
      idempotencyKey: 'send-1',
      thinking: 'high',
      clawxStagedFiles: [
        {
          fileName: 'image.png',
          filePath: '/tmp/image.png',
          mimeType: 'image/png',
        },
      ],
    });

    expect(result).toEqual({ runId: 'run-1' });
    expect(hostApiMock.chat.sendWithMedia).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      message: 'describe this',
      media: [
        {
          fileName: 'image.png',
          filePath: '/tmp/image.png',
          mimeType: 'image/png',
        },
      ],
      idempotencyKey: 'send-1',
      thinking: 'high',
    });
  });
});
