import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
}));

const TRANSCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/transcripts/fa3ccd85-397b-48d4-a465-200aefaa8bbe.jsonl',
);
const SESSION_KEY = 'agent:main:session-fa3ccd85';
const OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS = 8_000;

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: string; text?: string }>)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('\n');
}

function loadTranscriptMessages(path: string): RawMessage[] {
  const lines = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/);
  return lines.flatMap((line) => {
    const entry = JSON.parse(line) as { type?: string; message?: RawMessage };
    return entry.type === 'message' && entry.message ? [entry.message] : [];
  });
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

describe('fa3ccd85 transcript hydration fixture', () => {
  it('restores the long assistant reply from the real fa3ccd85 session transcript', () => {
    const transcriptMessages = loadTranscriptMessages(TRANSCRIPT_PATH);
    const assistant = transcriptMessages.filter((message) => message.role === 'assistant')
      .map((message) => ({ message, text: extractText(message.content) }))
      .sort((left, right) => right.text.length - left.text.length)[0];

    expect(assistant).toBeDefined();
    expect(assistant!.text.length).toBeGreaterThan(OPENCLAW_DEFAULT_HISTORY_TEXT_MAX_CHARS);
    expect(assistant!.text).toContain('企业无人办公转型的落地系统');
    expect(assistant!.text).toContain('这句话我觉得挺稳，也适合放进商业计划书。');

    const gatewayMessages: RawMessage[] = [{
      ...assistant!.message,
      content: simulateGatewayHistoryTruncationContent(assistant!.message.content),
    }];

    expect(gatewayHistoryNeedsTranscriptHydration(gatewayMessages)).toBe(true);

    const merged = mergeGatewayHistoryWithTranscript(gatewayMessages, transcriptMessages);
    const mergedText = extractText(merged[0]?.content);

    expect(mergedText).toBe(assistant!.text);
    expect(mergedText).not.toContain('...(truncated)...');
    expect(mergedText.length).toBe(8360);
  });

  it('hydrates truncated gateway history through the transcript fallback path', async () => {
    const transcriptMessages = loadTranscriptMessages(TRANSCRIPT_PATH);
    hostApiFetchMock.mockResolvedValueOnce({ messages: transcriptMessages });

    const assistant = transcriptMessages.filter((message) => message.role === 'assistant')
      .map((message) => ({ message, text: extractText(message.content) }))
      .sort((left, right) => right.text.length - left.text.length)[0];

    const gatewayMessages: RawMessage[] = [{
      ...assistant!.message,
      content: simulateGatewayHistoryTruncationContent(assistant!.message.content),
    }];

    const hydrated = await hydrateGatewayHistoryFromTranscript(
      SESSION_KEY,
      gatewayMessages,
      200,
    );

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      `/api/sessions/transcript?sessionKey=${encodeURIComponent(SESSION_KEY)}&limit=200`,
    );
    expect(extractText(hydrated[0]?.content)).toBe(assistant!.text);
    expect(gatewayHistoryNeedsTranscriptHydration(hydrated)).toBe(false);
  });
});
