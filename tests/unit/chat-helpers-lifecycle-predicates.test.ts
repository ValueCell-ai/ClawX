import { describe, expect, it } from 'vitest';
import {
  hasNonToolAssistantContent,
  hasPendingToolUse,
  isToolOnlyMessage,
} from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat';

/**
 * Cross-protocol coverage for the lifecycle predicates that drive whether
 * ClawX's UI keeps the Thinking… indicator / Execution Graph "active" or
 * tears them down.
 *
 * In production, ClawX consumes already-normalized messages from the OpenClaw
 * Gateway (camelCase, Anthropic-style content blocks). But the helpers are
 * written defensively so they also work when:
 *   - Anthropic Messages API output is passed through unchanged (snake_case,
 *     `type: "tool_use"`, `stop_reason: "tool_use"`)
 *   - OpenAI Chat Completions API output is normalized to a message-shaped
 *     object that retains the top-level `tool_calls` array
 *
 * This file documents the supported shapes via direct unit tests. If a future
 * runtime change starts emitting a different shape (e.g. raw OpenAI Responses
 * API `output[].type === "function_call"` items), these tests should be the
 * place to add new coverage — and the helpers extended accordingly.
 */

const ANTHROPIC_INTERMEDIATE_TOOL_USE: RawMessage = {
  id: 'anthropic-1',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Let me search for the weather.' },
    { type: 'tool_use', id: 'toolu_01', name: 'web_search', input: { query: 'Kunming' } },
  ],
  // Anthropic native: snake_case at message top level
  stop_reason: 'tool_use',
};

const ANTHROPIC_FINAL_TEXT: RawMessage = {
  id: 'anthropic-2',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'I have all I need.' },
    { type: 'text', text: 'The weather in Kunming is mild.' },
  ],
  stop_reason: 'end_turn',
};

const GATEWAY_NORMALIZED_INTERMEDIATE: RawMessage = {
  id: 'gateway-1',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Need to call a tool.' },
    { type: 'toolCall', id: 'tc1', name: 'web_search', input: { query: 'foo' } },
  ],
  // Gateway-normalized: camelCase + verb-cased stop reason
  stopReason: 'toolUse',
};

const GATEWAY_NORMALIZED_FINAL: RawMessage = {
  id: 'gateway-2',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Done thinking.' },
    { type: 'text', text: 'Here is the answer.' },
  ],
  stopReason: 'stop',
};

const GATEWAY_MIXED_PENDING_TOOL: RawMessage = {
  id: 'gateway-3',
  role: 'assistant',
  // Mixed [thinking, text, toolCall] with stopReason=toolUse — observed in
  // some MiniMax / gpt-5.5 variants. The text is real user-visible output
  // but the run is still pending a tool result.
  content: [
    { type: 'thinking', thinking: 'I should search first.' },
    { type: 'text', text: 'Let me search for that.' },
    { type: 'toolCall', id: 'tc2', name: 'web_search', input: { query: 'foo' } },
  ],
  stopReason: 'toolUse',
};

const OPENAI_CC_INTERMEDIATE_TOOL_CALL: RawMessage = {
  id: 'openai-cc-1',
  role: 'assistant',
  // OpenAI Chat Completions: `content` is a string (often empty when tools
  // are called) and the tool-call signal lives in a top-level `tool_calls`
  // array. There's no message-level `stop_reason`; the choice-level
  // `finish_reason: "tool_calls"` doesn't survive on the message itself.
  content: '',
  tool_calls: [
    {
      id: 'call_abc123',
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"foo"}' },
    },
  ],
};

const OPENAI_CC_FINAL_TEXT: RawMessage = {
  id: 'openai-cc-2',
  role: 'assistant',
  content: 'Here is the final answer.',
};

const OPENAI_CC_TOOLCALLS_CAMELCASE: RawMessage = {
  id: 'openai-cc-3',
  role: 'assistant',
  content: '',
  // Some adapters camelCase the field as `toolCalls`. The helper accepts both.
  toolCalls: [
    {
      id: 'call_xyz',
      type: 'function',
      function: { name: 'web_search', arguments: '{}' },
    },
  ],
};

const PLAIN_USER: RawMessage = {
  id: 'user-1',
  role: 'user',
  content: 'hello',
};

describe('hasPendingToolUse', () => {
  it('detects Anthropic-native intermediate (stop_reason=tool_use + tool_use block)', () => {
    expect(hasPendingToolUse(ANTHROPIC_INTERMEDIATE_TOOL_USE)).toBe(true);
  });

  it('detects Gateway-normalized intermediate (stopReason=toolUse + toolCall block)', () => {
    expect(hasPendingToolUse(GATEWAY_NORMALIZED_INTERMEDIATE)).toBe(true);
  });

  it('detects mixed [thinking, text, toolCall] with stopReason=toolUse', () => {
    expect(hasPendingToolUse(GATEWAY_MIXED_PENDING_TOOL)).toBe(true);
  });

  it('detects OpenAI Chat Completions intermediate via tool_calls array', () => {
    expect(hasPendingToolUse(OPENAI_CC_INTERMEDIATE_TOOL_CALL)).toBe(true);
  });

  it('detects OpenAI Chat Completions intermediate via toolCalls (camelCase) array', () => {
    expect(hasPendingToolUse(OPENAI_CC_TOOLCALLS_CAMELCASE)).toBe(true);
  });

  it('returns false for Anthropic-native final reply (end_turn + text)', () => {
    expect(hasPendingToolUse(ANTHROPIC_FINAL_TEXT)).toBe(false);
  });

  it('returns false for Gateway-normalized final reply (stopReason=stop + text)', () => {
    expect(hasPendingToolUse(GATEWAY_NORMALIZED_FINAL)).toBe(false);
  });

  it('returns false for OpenAI Chat Completions plain-text reply', () => {
    expect(hasPendingToolUse(OPENAI_CC_FINAL_TEXT)).toBe(false);
  });

  it('returns false for user messages', () => {
    expect(hasPendingToolUse(PLAIN_USER)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasPendingToolUse(undefined)).toBe(false);
  });
});

describe('hasNonToolAssistantContent', () => {
  // CRITICAL invariant: thinking blocks are NEVER counted as user-visible
  // output. Treating thinking as content was the root cause of the
  // "Thinking… disappears mid-tool-chain" bug.
  it('does NOT count thinking-only messages as user-visible content (Anthropic shape)', () => {
    const msg: RawMessage = {
      id: 'x',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'Some private reasoning…' }],
    };
    expect(hasNonToolAssistantContent(msg)).toBe(false);
  });

  it('does NOT count [thinking, tool_use] as user-visible content (Anthropic intermediate)', () => {
    expect(hasNonToolAssistantContent(ANTHROPIC_INTERMEDIATE_TOOL_USE)).toBe(false);
  });

  it('does NOT count [thinking, toolCall] as user-visible content (Gateway intermediate)', () => {
    expect(hasNonToolAssistantContent(GATEWAY_NORMALIZED_INTERMEDIATE)).toBe(false);
  });

  it('counts text blocks as user-visible (Anthropic final)', () => {
    expect(hasNonToolAssistantContent(ANTHROPIC_FINAL_TEXT)).toBe(true);
  });

  it('counts text blocks as user-visible (Gateway final)', () => {
    expect(hasNonToolAssistantContent(GATEWAY_NORMALIZED_FINAL)).toBe(true);
  });

  it('counts string content as user-visible (OpenAI ChatCompletions final)', () => {
    expect(hasNonToolAssistantContent(OPENAI_CC_FINAL_TEXT)).toBe(true);
  });

  it('does NOT count empty string content (OpenAI ChatCompletions intermediate)', () => {
    expect(hasNonToolAssistantContent(OPENAI_CC_INTERMEDIATE_TOOL_CALL)).toBe(false);
  });

  it('counts image blocks as user-visible', () => {
    const msg: RawMessage = {
      id: 'img',
      role: 'assistant',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
    };
    expect(hasNonToolAssistantContent(msg)).toBe(true);
  });
});

describe('isToolOnlyMessage', () => {
  it('flags Anthropic [thinking, tool_use] as tool-only', () => {
    expect(isToolOnlyMessage(ANTHROPIC_INTERMEDIATE_TOOL_USE)).toBe(true);
  });

  it('flags Gateway [thinking, toolCall] as tool-only', () => {
    expect(isToolOnlyMessage(GATEWAY_NORMALIZED_INTERMEDIATE)).toBe(true);
  });

  it('flags OpenAI ChatCompletions empty-content + tool_calls as tool-only', () => {
    expect(isToolOnlyMessage(OPENAI_CC_INTERMEDIATE_TOOL_CALL)).toBe(true);
  });

  it('does NOT flag mixed [thinking, text, toolCall] as tool-only (text present)', () => {
    // For mixed messages with real text output, isToolOnlyMessage alone is
    // insufficient — this is exactly why the lifecycle code uses
    // `isToolOnlyMessage(msg) || hasPendingToolUse(msg)`.
    expect(isToolOnlyMessage(GATEWAY_MIXED_PENDING_TOOL)).toBe(false);
    expect(hasPendingToolUse(GATEWAY_MIXED_PENDING_TOOL)).toBe(true);
  });

  it('does NOT flag a final text reply as tool-only', () => {
    expect(isToolOnlyMessage(GATEWAY_NORMALIZED_FINAL)).toBe(false);
    expect(isToolOnlyMessage(ANTHROPIC_FINAL_TEXT)).toBe(false);
    expect(isToolOnlyMessage(OPENAI_CC_FINAL_TEXT)).toBe(false);
  });
});

/**
 * Composite assertion: the trio `isToolOnlyMessage(msg) || hasPendingToolUse(msg)`
 * is the actual gate used by `applyLoadedMessages` and the runtime `final`
 * handler. This block proves that gate behaves consistently across all three
 * provider protocols ClawX may encounter.
 */
describe('lifecycle gate (isToolOnlyMessage || hasPendingToolUse)', () => {
  const gate = (msg: RawMessage) => isToolOnlyMessage(msg) || hasPendingToolUse(msg);

  it.each([
    ['Anthropic intermediate', ANTHROPIC_INTERMEDIATE_TOOL_USE, true],
    ['Gateway intermediate', GATEWAY_NORMALIZED_INTERMEDIATE, true],
    ['Gateway mixed [thinking,text,toolCall]', GATEWAY_MIXED_PENDING_TOOL, true],
    ['OpenAI CC intermediate (tool_calls)', OPENAI_CC_INTERMEDIATE_TOOL_CALL, true],
    ['OpenAI CC intermediate (toolCalls camelCase)', OPENAI_CC_TOOLCALLS_CAMELCASE, true],
    ['Anthropic final text (end_turn)', ANTHROPIC_FINAL_TEXT, false],
    ['Gateway final text (stop)', GATEWAY_NORMALIZED_FINAL, false],
    ['OpenAI CC final text', OPENAI_CC_FINAL_TEXT, false],
  ])('classifies %s as intermediate=%j', (_label, msg, expected) => {
    expect(gate(msg)).toBe(expected);
  });
});
