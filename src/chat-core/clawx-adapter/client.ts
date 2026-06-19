import { hostApi } from '@/lib/host-api';
import type { ChatCoreClient } from '@/chat-core/openclaw-port/types';
import { extractClawXStagedFiles, stripClawXAdapterFields } from './attachments';

type ChatSendWithMediaResponse = {
  success?: boolean;
  result?: unknown;
  error?: string;
};

function unwrapMediaSendResult(response: ChatSendWithMediaResponse): unknown {
  if (response?.success === false) {
    throw new Error(response.error || 'chat.send media request failed');
  }
  return response?.result ?? response;
}

export function createClawXChatCoreClient(): ChatCoreClient {
  return {
    async request<T>(
      method: string,
      params: Record<string, unknown> = {},
      timeoutMs?: number,
    ): Promise<T> {
      if (method === 'chat.send') {
        const stagedFiles = extractClawXStagedFiles(params);
        if (stagedFiles.length > 0) {
          const thinking = typeof params.thinking === 'string' && params.thinking.trim()
            ? params.thinking.trim()
            : undefined;
          const response = await hostApi.chat.sendWithMedia({
            sessionKey: String(params.sessionKey ?? ''),
            message: String(params.message ?? ''),
            media: stagedFiles,
            idempotencyKey: typeof params.idempotencyKey === 'string'
              ? params.idempotencyKey
              : '',
            ...(thinking ? { thinking } : {}),
          });
          return unwrapMediaSendResult(response as ChatSendWithMediaResponse) as T;
        }
      }

      return hostApi.gateway.rpc<T>(method, stripClawXAdapterFields(params), timeoutMs);
    },
  };
}
