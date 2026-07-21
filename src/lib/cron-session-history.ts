import type { SessionNotification } from '@agentclientprotocol/sdk';
import { hostApi } from '@/lib/host-api';
import type { RawMessage } from '@/stores/chat/types';

export async function fetchCronSessionHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  const response = await hostApi.cron.sessionHistory({ sessionKey, limit });
  return Array.isArray(response.messages) ? response.messages : [];
}

function getCronHistoryMessageText(content: RawMessage['content']): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const value = block as { type?: unknown; text?: unknown };
      return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Project authoritative cron run summaries into ACP's in-memory timeline shape.
 * This is used only when OpenClaw returns no ACP replay for a cron base session.
 */
export function buildCronHistoryAcpNotifications(
  sessionKey: string,
  messages: RawMessage[],
): SessionNotification[] {
  return messages.flatMap((message, index): SessionNotification[] => {
    const text = getCronHistoryMessageText(message.content);
    if (!text) return [];
    const messageId = String(message.id ?? `cron-history-${index}`);
    if (message.role === 'user') {
      return [{
        sessionId: sessionKey,
        update: {
          sessionUpdate: 'user_message_chunk',
          messageId,
          content: { type: 'text', text },
        },
      }];
    }
    return [{
      sessionId: sessionKey,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId,
        content: { type: 'text', text },
      },
    }];
  });
}
