import { describe, expect, it, vi } from 'vitest';
import {
  extractAssistantCommentaryText,
  extractAssistantDisplayParts,
  extractAssistantVisibleText,
  extractThinkingText,
  isHiddenAssistantMessage,
  isHiddenStreamText,
  stripHeartbeatTokenForDisplay,
} from '@/chat-core/openclaw-port/message-extraction';

function signature(phase: 'commentary' | 'final_answer' | 'ignored'): string {
  return JSON.stringify({ v: 1, id: `sig-${phase}`, phase });
}

describe('OpenClaw assistant message extraction', () => {
  it('prefers final_answer while commentary and thinking stay separate', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Checking the request.' },
        { type: 'text', text: 'I am reading the files.', textSignature: signature('commentary') },
        { type: 'text', text: 'Use the final result.', textSignature: signature('final_answer') },
        { type: 'text', text: 'Legacy fallback should not revive.' },
      ],
    };

    expect(extractAssistantVisibleText(message)).toBe('Use the final result.');
    expect(extractAssistantCommentaryText(message)).toBe('I am reading the files.');
    expect(extractThinkingText(message)).toBe('Checking the request.');
    expect(extractAssistantDisplayParts(message)).toEqual({
      visibleText: 'Use the final result.',
      commentaryText: 'I am reading the files.',
      thinkingText: 'Checking the request.',
    });
  });

  it('uses direct top-level commentary phase metadata and hides commentary-only messages', () => {
    const message = {
      role: 'assistant',
      phase: 'commentary',
      content: 'Direct commentary update.',
    };

    expect(extractAssistantCommentaryText(message)).toBe('Direct commentary update.');
    expect(extractAssistantVisibleText(message)).toBeUndefined();
    expect(isHiddenAssistantMessage(message)).toBe(true);
  });

  it('uses direct commentary phase metadata on content text blocks', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', phase: 'commentary', text: 'Block commentary update.' }],
    };

    expect(extractAssistantCommentaryText(message)).toBe('Block commentary update.');
    expect(extractAssistantVisibleText(message)).toBeUndefined();
  });

  it('joins multiple final_answer text blocks with newlines', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello', textSignature: signature('final_answer') },
        { type: 'text', text: 'world', textSignature: signature('final_answer') },
      ],
    };

    expect(extractAssistantVisibleText(message)).toBe('Hello\nworld');
  });

  it('extracts legacy think tags without leaking them into visible text', () => {
    const message = {
      role: 'assistant',
      content: '<think>Draft privately.</think>\nVisible answer.\n<thinking>Double-check privately.</thinking>',
    };

    expect(extractAssistantVisibleText(message)).toBe('Visible answer.');
    expect(extractThinkingText(message)).toBe('Draft privately.\n\nDouble-check privately.');
  });

  it('extracts reasoning-style thinking blocks from history messages', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'reasoning', reasoning: 'Plan with the available facts.' },
        { type: 'thinking', text: 'Double-check the answer.' },
        { type: 'text', text: 'Visible answer.' },
      ],
    };

    expect(extractThinkingText(message)).toBe('Plan with the available facts.\n\nDouble-check the answer.');
    expect(extractAssistantVisibleText(message)).toBe('Visible answer.');
  });

  it('logs reasoning-token messages that do not include displayable thinking text', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    expect(extractThinkingText({
      id: 'assistant-no-thinking-text',
      role: 'assistant',
      content: [{ type: 'text', text: 'Visible answer.' }],
      usage: { reasoningTokens: 32 },
    })).toBeUndefined();

    expect(debug).toHaveBeenCalledWith(
      '[ClawX Chat] assistant message has reasoning tokens but no displayable thinking',
      expect.objectContaining({
        id: 'assistant-no-thinking-text',
        reasoningTokens: 32,
      }),
    );

    debug.mockRestore();
  });

  it('keeps legacy unphased assistant text visible when no final_answer exists', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Legacy visible answer.' }],
    };

    expect(extractAssistantVisibleText(message)).toBe('Legacy visible answer.');
    expect(extractAssistantDisplayParts(message)).toEqual({
      visibleText: 'Legacy visible answer.',
    });
  });

  it('keeps legacy text hidden when a recognized final_answer block is hidden', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'NO_REPLY', textSignature: signature('final_answer') },
        { type: 'text', text: 'Legacy fallback should stay hidden.' },
      ],
    };

    expect(extractAssistantVisibleText(message)).toBeUndefined();
    expect(extractAssistantDisplayParts(message)).toEqual({});
    expect(isHiddenAssistantMessage(message)).toBe(true);
  });

  it('hides heartbeat, NO_REPLY, empty, and thinking-only assistant messages', () => {
    expect(isHiddenStreamText('HEARTBEAT_OK')).toBe(true);
    expect(isHiddenStreamText('NO_REPLY')).toBe(true);
    expect(isHiddenStreamText('')).toBe(true);
    expect(stripHeartbeatTokenForDisplay('Real answer.\nNO_REPLY')).toEqual({
      shouldSkip: false,
      text: 'Real answer.',
    });
    expect(stripHeartbeatTokenForDisplay('HEARTBEAT_OK')).toEqual({
      shouldSkip: true,
      text: '',
    });

    expect(isHiddenAssistantMessage({ role: 'assistant', content: 'HEARTBEAT_OK' })).toBe(true);
    expect(isHiddenAssistantMessage({ role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY' }] })).toBe(true);
    expect(isHiddenAssistantMessage({ role: 'assistant', content: '' })).toBe(true);
    expect(isHiddenAssistantMessage({ role: 'assistant', content: [{ type: 'thinking', thinking: 'Private only.' }] })).toBe(true);
    expect(isHiddenAssistantMessage({ role: 'user', content: 'NO_REPLY' })).toBe(false);
    expect(isHiddenAssistantMessage(null)).toBe(false);
    expect(isHiddenAssistantMessage('NO_REPLY')).toBe(false);
  });
});
