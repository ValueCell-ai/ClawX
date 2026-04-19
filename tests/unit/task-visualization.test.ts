import { describe, expect, it } from 'vitest';
import { deriveTaskSteps, parseSubagentCompletionInfo } from '@/pages/Chat/task-visualization';
import { stripProcessMessagePrefix } from '@/pages/Chat/message-utils';
import type { RawMessage, ToolStatus } from '@/stores/chat';

describe('deriveTaskSteps', () => {
  it('builds running steps from streaming thinking and tool status', () => {
    const streamingTools: ToolStatus[] = [
      {
        name: 'web_search',
        status: 'running',
        updatedAt: Date.now(),
        summary: 'Searching docs',
      },
    ];

    const steps = deriveTaskSteps({
      messages: [],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Compare a few approaches before coding.' },
          { type: 'tool_use', id: 'tool-1', name: 'web_search', input: { query: 'openclaw task list' } },
        ],
      },
      streamingTools,
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'stream-thinking-0',
        label: 'Thinking',
        status: 'running',
        kind: 'thinking',
      }),
      expect.objectContaining({
        label: 'web_search',
        status: 'running',
        kind: 'tool',
      }),
    ]);
  });

  it('keeps completed tool steps visible while a later tool is still streaming', () => {
    const steps = deriveTaskSteps({
      messages: [
        {
          role: 'assistant',
          id: 'assistant-history',
          content: [
            { type: 'tool_use', id: 'tool-read', name: 'read', input: { filePath: '/tmp/a.md' } },
          ],
        },
      ],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-grep', name: 'grep', input: { pattern: 'TODO' } },
        ],
      },
      streamingTools: [
        {
          toolCallId: 'tool-grep',
          name: 'grep',
          status: 'running',
          updatedAt: Date.now(),
          summary: 'Scanning files',
        },
      ],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'tool-read',
        label: 'read',
        status: 'completed',
        kind: 'tool',
      }),
      expect.objectContaining({
        id: 'tool-grep',
        label: 'grep',
        status: 'running',
        kind: 'tool',
      }),
    ]);
  });

  it('upgrades a completed historical tool step when streaming status reports a later state', () => {
    const steps = deriveTaskSteps({
      messages: [
        {
          role: 'assistant',
          id: 'assistant-history',
          content: [
            { type: 'tool_use', id: 'tool-read', name: 'read', input: { filePath: '/tmp/a.md' } },
          ],
        },
      ],
      streamingMessage: null,
      streamingTools: [
        {
          toolCallId: 'tool-read',
          name: 'read',
          status: 'error',
          updatedAt: Date.now(),
          summary: 'Permission denied',
        },
      ],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'tool-read',
        label: 'read',
        status: 'error',
        kind: 'tool',
        detail: 'Permission denied',
      }),
    ]);
  });

  it('keeps all steps when the execution graph exceeds the previous max length', () => {
    const messages: RawMessage[] = Array.from({ length: 9 }, (_, index) => ({
      role: 'assistant',
      id: `assistant-${index}`,
      content: [
        { type: 'tool_use', id: `tool-${index}`, name: `read_${index}`, input: { filePath: `/tmp/${index}.md` } },
      ],
    }));

    const steps = deriveTaskSteps({
      messages,
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-live', name: 'grep_live', input: { pattern: 'TODO' } },
        ],
      },
      streamingTools: [
        {
          toolCallId: 'tool-live',
          name: 'grep_live',
          status: 'running',
          updatedAt: Date.now(),
          summary: 'Scanning current workspace',
        },
      ],
    });

    expect(steps).toHaveLength(10);
    expect(steps[0]).toEqual(expect.objectContaining({
      id: 'tool-0',
      label: 'read_0',
      status: 'completed',
    }));
    expect(steps.at(-1)).toEqual(expect.objectContaining({
      id: 'tool-live',
      label: 'grep_live',
      status: 'running',
    }));
  });

  it('keeps recent completed steps from assistant history', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'assistant-1',
        content: [
          { type: 'thinking', thinking: 'Reviewing the code path.' },
          { type: 'tool_use', id: 'tool-2', name: 'read_file', input: { path: 'src/App.tsx' } },
        ],
      },
    ];

    const steps = deriveTaskSteps({
      messages,
      streamingMessage: null,
      streamingTools: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'history-thinking-assistant-1-0',
        label: 'Thinking',
        status: 'completed',
        kind: 'thinking',
      }),
      expect.objectContaining({
        id: 'tool-2',
        label: 'read_file',
        status: 'completed',
        kind: 'tool',
      }),
    ]);
  });

  it('splits cumulative streaming thinking into separate execution steps', () => {
    const steps = deriveTaskSteps({
      messages: [],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reviewing X.' },
          { type: 'thinking', thinking: 'Reviewing X. Comparing Y.' },
          { type: 'thinking', thinking: 'Reviewing X. Comparing Y. Drafting answer.' },
        ],
      },
      streamingTools: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'stream-thinking-0',
        detail: 'Reviewing X.',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'stream-thinking-1',
        detail: 'Comparing Y.',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'stream-thinking-2',
        detail: 'Drafting answer.',
        status: 'running',
      }),
    ]);
  });

  it('keeps earlier reply segments in the graph when the last streaming segment is rendered separately', () => {
    const steps = deriveTaskSteps({
      messages: [],
      streamingMessage: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checked X.' },
          { type: 'text', text: 'Checked X. Checked Snowball.' },
          { type: 'text', text: 'Checked X. Checked Snowball. Here is the summary.' },
        ],
      },
      streamingTools: [],
      omitLastStreamingMessageSegment: true,
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'stream-message-0',
        detail: 'Checked X.',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'stream-message-1',
        detail: 'Checked Snowball.',
        status: 'completed',
      }),
    ]);
  });

  it('folds earlier reply segments into the graph but leaves the final answer for the chat bubble', () => {
    const steps = deriveTaskSteps({
      messages: [
        {
          role: 'assistant',
          id: 'assistant-reply',
          content: [
            { type: 'text', text: 'Checked X.' },
            { type: 'text', text: 'Checked X. Checked Snowball.' },
            { type: 'text', text: 'Checked X. Checked Snowball. Here is the summary.' },
          ],
        },
      ],
      streamingMessage: null,
      streamingTools: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'history-message-assistant-reply-0',
        detail: 'Checked X.',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'history-message-assistant-reply-1',
        detail: 'Checked Snowball.',
        status: 'completed',
      }),
    ]);
  });

  it('strips folded process narration from the final reply text', () => {
    expect(stripProcessMessagePrefix(
      'Checked X. Checked Snowball. Here is the summary.',
      ['Checked X.', 'Checked Snowball.'],
    )).toBe('Here is the summary.');
  });

  it('builds a branch for spawned subagents', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        id: 'assistant-2',
        content: [
          {
            type: 'tool_use',
            id: 'spawn-1',
            name: 'sessions_spawn',
            input: { agentId: 'coder', task: 'inspect repo' },
          },
          {
            type: 'tool_use',
            id: 'yield-1',
            name: 'sessions_yield',
            input: { message: 'wait coder finishes' },
          },
        ],
      },
    ];

    const steps = deriveTaskSteps({
      messages,
      streamingMessage: null,
      streamingTools: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'spawn-1',
        label: 'sessions_spawn',
        depth: 1,
      }),
      expect.objectContaining({
        id: 'spawn-1:branch',
        label: 'coder run',
        depth: 2,
        parentId: 'spawn-1',
      }),
      expect.objectContaining({
        id: 'yield-1',
        label: 'sessions_yield',
        depth: 3,
        parentId: 'spawn-1:branch',
      }),
    ]);
  });

  it('parses internal subagent completion events from injected user messages', () => {
    const info = parseSubagentCompletionInfo({
      role: 'user',
      content: [{
        type: 'text',
        text: `[Internal task completion event]
source: subagent
session_key: agent:coder:subagent:child-123
session_id: child-session-id
status: completed successfully`,
      }],
    } as RawMessage);

    expect(info).toEqual({
      sessionKey: 'agent:coder:subagent:child-123',
      sessionId: 'child-session-id',
      agentId: 'coder',
    });
  });
});
