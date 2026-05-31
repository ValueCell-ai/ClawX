import { hostApi } from '@/lib/host-api';
import type { RawMessage } from '@/stores/chat/types';

export async function fetchCronSessionHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  const response = await hostApi.cron.sessionHistory({ sessionKey, limit });
  return Array.isArray(response.messages) ? response.messages : [];
}
