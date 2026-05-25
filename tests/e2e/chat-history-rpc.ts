import { DEFAULT_CHAT_HISTORY_MAX_CHARS } from '@/stores/chat/history-rpc-params';

export function chatHistoryRpcParams(sessionKey: string, limit: number) {
  return {
    sessionKey,
    limit,
    maxChars: DEFAULT_CHAT_HISTORY_MAX_CHARS,
  };
}

export { DEFAULT_CHAT_HISTORY_MAX_CHARS as CHAT_HISTORY_MAX_CHARS };
