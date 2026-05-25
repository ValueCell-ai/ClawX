import { DEFAULT_CHAT_HISTORY_MAX_CHARS } from '@/stores/chat/history-rpc-params';

export function chatHistoryRpcParams(sessionKey: string, limit: number) {
  return {
    sessionKey,
    limit,
    maxChars: DEFAULT_CHAT_HISTORY_MAX_CHARS,
  };
}

type GatewayRpcMock = {
  mockImplementation: (
    fn: (method: string, params?: unknown, timeoutMs?: number) => unknown,
  ) => unknown;
};

export function installGatewayRpcDefaults(mock: GatewayRpcMock): void {
  mock.mockImplementation(async (method: string) => {
    if (method === 'config.get') return {};
    if (method === 'chat.history') return { messages: [] };
    throw new Error(`Unexpected gateway RPC: ${method}`);
  });
}

export function mockGatewayChatHistory(
  mock: GatewayRpcMock,
  result: Record<string, unknown>,
): void {
  mock.mockImplementation(async (method: string) => {
    if (method === 'config.get') return {};
    if (method === 'chat.history') return result;
    throw new Error(`Unexpected gateway RPC: ${method}`);
  });
}

export async function prewarmChatHistoryMaxCharsCache(): Promise<void> {
  const { resetChatHistoryMaxCharsCache, resolveChatHistoryMaxChars } = await import(
    '@/stores/chat/history-rpc-params'
  );
  resetChatHistoryMaxCharsCache();
  await resolveChatHistoryMaxChars();
}
