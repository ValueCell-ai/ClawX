import { hostApi } from '@/lib/host-api';
import type { RawMessage } from './types';

export async function loadSessionTranscriptFallback(
  sessionKey: string,
  limit = 200,
): Promise<RawMessage[]> {
  try {
    const response = await hostApi.sessions.history({ sessionKey, limit });
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('[chat.history] transcript fallback failed:', error);
    return [];
  }
}
