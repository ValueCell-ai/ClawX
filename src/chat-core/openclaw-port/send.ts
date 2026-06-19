import type { ChatCoreClient, ChatQueueItem } from './types';

export function createIdempotencyKey(prefix = 'clawx-chat'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export function isRecoverableSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rpc timeout: chat.send')
    || normalized.includes('disconnected')
    || normalized.includes('not connected')
    || normalized.includes('gateway unavailable')
  );
}

export function createQueueItem(input: {
  sessionKey: string;
  message: string;
  id?: string;
  idempotencyKey?: string;
  createdAt?: number;
  historyMessageCountAtEnqueue?: number;
  attachments?: ChatQueueItem['attachments'];
}): ChatQueueItem {
  return {
    id: input.id ?? createIdempotencyKey('queue'),
    sessionKey: input.sessionKey,
    message: input.message,
    idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
    createdAt: input.createdAt ?? Date.now(),
    ...(typeof input.historyMessageCountAtEnqueue === 'number'
      ? { historyMessageCountAtEnqueue: input.historyMessageCountAtEnqueue }
      : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    state: 'queued',
  };
}

export async function sendQueuedItem(
  client: ChatCoreClient,
  item: ChatQueueItem,
  extraParams: Record<string, unknown> = {},
): Promise<{ runId: string | null }> {
  const response = await client.request<{ runId?: string; idempotencyKey?: string }>(
    'chat.send',
    {
      ...extraParams,
      sessionKey: item.sessionKey,
      message: item.message,
      deliver: false,
      idempotencyKey: item.idempotencyKey,
    },
    120_000,
  );
  return { runId: response.runId ?? response.idempotencyKey ?? null };
}
