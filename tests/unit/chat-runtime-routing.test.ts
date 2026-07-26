import { beforeEach, describe, expect, it, vi } from 'vitest';

const { acpService, createAcpChatServiceMock } = vi.hoisted(() => {
  const service = {
    loadSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancelSession: vi.fn(),
    respondPermission: vi.fn(),
  };
  return {
    acpService: service,
    createAcpChatServiceMock: vi.fn(() => service),
  };
});

vi.mock('@electron/services/acp-chat-service', () => ({
  createAcpChatService: createAcpChatServiceMock,
}));

describe('typed Chat runtime routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends cc-connect Chat through the active RuntimeProvider', async () => {
    const sendMessageWithMedia = vi.fn().mockResolvedValue({ runId: 'cc-run-1' });
    const gatewayManager = { rpc: vi.fn() };
    const runtimeManager = {
      getActiveKind: vi.fn().mockResolvedValue('cc-connect'),
      getActiveProvider: vi.fn(() => ({ sendMessageWithMedia })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({
      gatewayManager: gatewayManager as never,
      runtimeManager: runtimeManager as never,
      mainWindow: {} as never,
    });
    const payload = {
      sessionKey: 'agent:main:main',
      message: 'hello cc-connect',
      idempotencyKey: 'message-1',
      media: [],
    };

    await expect(api.sendWithMedia(payload)).resolves.toEqual({
      success: true,
      result: { runId: 'cc-run-1' },
    });
    expect(sendMessageWithMedia).toHaveBeenCalledWith(payload);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects every OpenClaw ACP operation while cc-connect is active', async () => {
    const runtimeManager = {
      getActiveKind: vi.fn().mockResolvedValue('cc-connect'),
      getActiveProvider: vi.fn(),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({
      gatewayManager: {} as never,
      runtimeManager: runtimeManager as never,
      mainWindow: {} as never,
    });

    const results = await Promise.all([
      api.loadAcpSession({ sessionKey: 'agent:main:main', cwd: '/workspace' }),
      api.sendAcpPrompt({ sessionKey: 'agent:main:main', cwd: '/workspace', message: 'hello' }),
      api.cancelAcpSession({ sessionKey: 'agent:main:main' }),
      api.respondAcpPermission({
        sessionKey: 'agent:main:main',
        requestId: 'permission-1',
        outcome: { outcome: 'cancelled' },
      }),
    ]);

    for (const result of results) {
      expect(result).toEqual({
        success: false,
        error: 'ACP chat is only available for the OpenClaw runtime',
      });
    }
    expect(acpService.loadSession).not.toHaveBeenCalled();
    expect(acpService.sendPrompt).not.toHaveBeenCalled();
    expect(acpService.cancelSession).not.toHaveBeenCalled();
    expect(acpService.respondPermission).not.toHaveBeenCalled();
  });
});
