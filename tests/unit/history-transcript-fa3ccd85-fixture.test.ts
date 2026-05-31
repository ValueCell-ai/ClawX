import { describe, expect, it, vi } from 'vitest';
import { hydrateGatewayHistoryFromTranscript } from '@/stores/chat/history-transcript-hydrate';
import {
  gatewayHistoryNeedsTranscriptHydration,
  mergeGatewayHistoryWithTranscript,
} from '@/stores/chat/history-transcript-merge';
import type { RawMessage } from '@/stores/chat/types';

const { hostApiFetchMock } = vi.hoisted(() => ({
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    sessions: {
      history: (input: { sessionKey?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (input.sessionKey) params.set('sessionKey', input.sessionKey);
        params.set('limit', String(input.limit ?? 200));
        return hostApiFetchMock(`/api/sessions/transcript?${params.toString()}`);
      },
    },
  },
}));

const SESSION_KEY = 'agent:main:session-long-reply';
const OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS = 8_000;
const LONG_REPLY_HEAD = 'Cooper，我先给一个直接判断：**你们现在最有价值的不是“AI Agent 客户端”，而是“企业无人办公转型的落地系统”**。';
const LONG_REPLY_TAIL = '这句话我觉得挺稳，也适合放进商业计划书。';
const LONG_REPLY_LENGTH = 8360;

function buildLongAssistantText(): string {
  const fillerLength = Math.max(0, LONG_REPLY_LENGTH - LONG_REPLY_HEAD.length - LONG_REPLY_TAIL.length);
  return `${LONG_REPLY_HEAD}${'x'.repeat(fillerLength)}${LONG_REPLY_TAIL}`;
}

function buildLongAssistantMessage(): RawMessage {
  return {
    id: 'assistant-long-reply',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: buildLongAssistantText() },
    ],
    timestamp: 1779695766656,
  };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: string; text?: string }>)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n');
}

function simulateGatewayHistoryTruncation(text: string, maxChars = OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...(truncated)...`;
}

function simulateGatewayHistoryTruncationContent(
  content: unknown,
  maxChars = OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS,
): unknown {
  if (typeof content === 'string') {
    return simulateGatewayHistoryTruncation(content, maxChars);
  }
  if (!Array.isArray(content)) return content;
  return (content as Array<{ type?: string; text?: string }>).map((block) => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block;
    return {
      ...block,
      text: simulateGatewayHistoryTruncation(block.text, maxChars),
    };
  });
}

describe('long assistant transcript hydration regression', () => {
  it('restores a long assistant reply truncated by the default chat.history limit', () => {
    const assistant = buildLongAssistantMessage();
    const fullText = extractText(assistant.content);

    expect(fullText.length).toBe(LONG_REPLY_LENGTH);
    expect(fullText.length).toBeGreaterThan(OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS);
    expect(fullText).toContain('企业无人办公转型的落地系统');
    expect(fullText).toContain(LONG_REPLY_TAIL);

    const transcriptMessages: RawMessage[] = [assistant];
    const gatewayMessages: RawMessage[] = [{
      ...assistant,
      content: simulateGatewayHistoryTruncationContent(assistant.content),
    }];

    expect(gatewayHistoryNeedsTranscriptHydration(gatewayMessages)).toBe(true);

    const merged = mergeGatewayHistoryWithTranscript(gatewayMessages, transcriptMessages);
    const mergedText = extractText(merged[0]?.content);

    expect(mergedText).toBe(fullText);
    expect(mergedText).not.toContain('...(truncated)...');
    expect(mergedText.length).toBe(LONG_REPLY_LENGTH);
  });

  it('hydrates truncated gateway history through the transcript fallback path', async () => {
    const assistant = buildLongAssistantMessage();
    const fullText = extractText(assistant.content);
    const transcriptMessages: RawMessage[] = [assistant];

    hostApiFetchMock.mockResolvedValueOnce({ messages: transcriptMessages });

    const gatewayMessages: RawMessage[] = [{
      ...assistant,
      content: simulateGatewayHistoryTruncationContent(assistant.content),
    }];

    const hydrated = await hydrateGatewayHistoryFromTranscript(
      SESSION_KEY,
      gatewayMessages,
      200,
    );

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      `/api/sessions/transcript?sessionKey=${encodeURIComponent(SESSION_KEY)}&limit=200`,
    );
    expect(extractText(hydrated[0]?.content)).toBe(fullText);
    expect(gatewayHistoryNeedsTranscriptHydration(hydrated)).toBe(false);
  });
});
