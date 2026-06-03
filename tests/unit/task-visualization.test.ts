import { describe, expect, it } from 'vitest';
import {
  deriveRuntimeTaskSteps,
  deriveTaskSteps,
  findReplyMessageIndex,
  parseSubagentCompletionInfo,
  segmentHasFinalReply,
} from '@/pages/Chat/task-visualization';
import { stripProcessMessagePrefix } from '@/pages/Chat/message-utils';
import { applyRuntimeEventToRuns } from '@/stores/chat/runtime-graph';
import type { RawMessage, ToolStatus } from '@/stores/chat';

describe('runtime graph state', () => {
  it('keeps distinct runtime tool updates for the same tool call', () => {
    const started = applyRuntimeEventToRuns({}, {
      type: 'tool.started',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'exec',
    });
    const firstUpdate = applyRuntimeEventToRuns(started, {
      type: 'tool.updated',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'exec',
      partialResult: 'step 1',
    });
    const secondUpdate = applyRuntimeEventToRuns(firstUpdate, {
      type: 'tool.updated',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'exec',
      partialResult: 'step 2',
    });
    const duplicateSecondUpdate = applyRuntimeEventToRuns(secondUpdate, {
      type: 'tool.updated',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'exec',
      partialResult: 'step 2',
    });

    expect(secondUpdate['run-1'].events).toHaveLength(3);
    expect(duplicateSecondUpdate['run-1'].events).toHaveLength(3);
  });

  it('does not drop full-text assistant deltas that do not extend the previous prefix', () => {
    const first = applyRuntimeEventToRuns({}, {
      type: 'assistant.delta',
      runId: 'run-1',
      text: 'hello',
    });
    const second = applyRuntimeEventToRuns(first, {
      type: 'assistant.delta',
      runId: 'run-1',
      text: 'corrected',
    });

    expect(second['run-1'].assistantText).toBe('corrected');
  });
});

describe('deriveTaskSteps', () => {
  it('projects runtime tool events into active execution graph steps', () => {
    const steps = deriveRuntimeTaskSteps({
      runId: 'run-1',
      status: 'running',
      assistantText: '',
      thinkingText: '',
      events: [
        { type: 'run.started', runId: 'run-1', sessionKey: 'agent:main:main' },
        { type: 'tool.started', runId: 'run-1', sessionKey: 'agent:main:main', toolCallId: 'call-1', name: 'read', args: { filePath: '/tmp/demo.md' } },
        { type: 'command.output', runId: 'run-1', sessionKey: 'agent:main:main', toolCallId: 'call-1', itemId: 'cmd-1', title: 'exec output', output: 'Scanning workspace', status: 'running', phase: 'update' },
        { type: 'tool.completed', runId: 'run-1', sessionKey: 'agent:main:main', toolCallId: 'call-1', name: 'read', result: { summary: 'Done' }, isError: false },
      ],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'call-1',
        label: 'read',
        status: 'completed',
        kind: 'tool',
      }),
      expect.objectContaining({
        id: 'cmd-1',
        label: 'exec output',
        status: 'running',
        kind: 'message',
        detail: 'Scanning workspace',
      }),
    ]);
  });
  it('builds running steps from streaming tool status without exposing chain-of-thought', () => {
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

  it('keeps recent completed tool steps from assistant history', () => {
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
        id: 'tool-2',
        label: 'read_file',
        status: 'completed',
        kind: 'tool',
      }),
    ]);
  });

  it('does not expose streaming chain-of-thought in the execution graph', () => {
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

    expect(steps).toEqual([]);
  });

  it('skips internal assistant turns and hides NO_REPLY from the execution graph', () => {
    const steps = deriveTaskSteps({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Continue the OpenClaw runtime event internally.' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'NO_REPLY' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-image', name: 'image_generate', input: { prompt: 'astronaut' } },
          ],
        },
      ],
      streamingMessage: null,
      streamingTools: [],
    });

    expect(steps).toEqual([
      expect.objectContaining({
        id: 'tool-image',
        label: 'image_generate',
        kind: 'tool',
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

describe('run completion detection', () => {
  it('treats delivered image attachments as a final reply after image generation tools', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'tool-image',
          name: 'image_generate',
          arguments: { prompt: 'wheat' },
        }],
      },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'tool-message',
          name: 'message',
          arguments: {
            action: 'send',
            attachments: [{ path: '/tmp/wheat.png' }],
          },
        }],
      },
      {
        role: 'assistant',
        content: [{
          type: 'image',
          url: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
          mimeType: 'image/png',
          alt: 'wheat.png',
        }],
        _attachedFiles: [{
          fileName: 'wheat.png',
          mimeType: 'image/png',
          fileSize: 42,
          preview: 'data:image/png;base64,ok',
          gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
          source: 'gateway-media',
        }],
      },
    ];

    expect(segmentHasFinalReply(messages)).toBe(true);
    expect(findReplyMessageIndex(messages, false)).toBe(2);
  });
});
