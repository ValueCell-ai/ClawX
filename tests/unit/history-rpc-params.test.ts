import { describe, expect, it, vi } from 'vitest';
import {
  buildChatHistoryRpcParams,
  DEFAULT_CHAT_HISTORY_MAX_CHARS,
  getChatHistoryMaxChars,
  OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP,
  resetChatHistoryMaxCharsCache,
  resolveChatHistoryMaxChars,
} from '@/stores/chat/history-rpc-params';

describe('history-rpc-params', () => {
  it('builds chat.history params with maxChars', () => {
    expect(buildChatHistoryRpcParams('agent:main:main', 200, 120_000)).toEqual({
      sessionKey: 'agent:main:main',
      limit: 200,
      maxChars: 120_000,
    });
  });

  it('defaults to the OpenClaw cap when config is unavailable', async () => {
    resetChatHistoryMaxCharsCache();
    await expect(resolveChatHistoryMaxChars()).resolves.toBe(DEFAULT_CHAT_HISTORY_MAX_CHARS);
    expect(DEFAULT_CHAT_HISTORY_MAX_CHARS).toBe(OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP);
  });

  it('reads gateway.webchat.chatHistoryMaxChars from config.get', async () => {
    resetChatHistoryMaxCharsCache();
    const rpc = vi.fn(async (method: string) => {
      if (method === 'config.get') {
        return { config: { gateway: { webchat: { chatHistoryMaxChars: 250_000 } } } };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    await expect(resolveChatHistoryMaxChars(rpc)).resolves.toBe(DEFAULT_CHAT_HISTORY_MAX_CHARS);
    await vi.waitFor(async () => {
      await expect(resolveChatHistoryMaxChars()).resolves.toBe(250_000);
    });
  });

  it('clamps configured maxChars to the OpenClaw cap', async () => {
    resetChatHistoryMaxCharsCache();
    const rpc = vi.fn(async (method: string) => {
      if (method === 'config.get') {
        return { config: { gateway: { webchat: { chatHistoryMaxChars: 900_000 } } } };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    await expect(resolveChatHistoryMaxChars(rpc)).resolves.toBe(DEFAULT_CHAT_HISTORY_MAX_CHARS);
    await vi.waitFor(async () => {
      await expect(resolveChatHistoryMaxChars()).resolves.toBe(OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP);
    });
  });

  it('returns the default cap immediately and refreshes config in the background', async () => {
    resetChatHistoryMaxCharsCache();
    const rpc = vi.fn(async (method: string) => {
      if (method === 'config.get') {
        return { config: { gateway: { webchat: { chatHistoryMaxChars: 180_000 } } } };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });

    expect(getChatHistoryMaxChars(rpc)).toBe(500_000);
    await vi.waitFor(() => {
      expect(getChatHistoryMaxChars()).toBe(180_000);
    });
  });
});
