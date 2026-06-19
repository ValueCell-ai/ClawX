import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSurface } from '@/pages/Chat/ChatSurface';
import { ChatComposer } from '@/pages/Chat/ChatComposer';
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';

const thumbnailsMock = vi.hoisted(() => vi.fn());
const statFileMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'runStatus.idle': 'Idle',
        'runStatus.running': 'Running',
        'runStatus.done': 'Done',
        'runStatus.interrupted': 'Interrupted',
        'runStatus.error': 'Error',
        'runtime.compaction.active': 'Compacting context',
        'runtime.compaction.retrying': 'Retrying after compaction',
        'runtime.compaction.complete': 'Context compacted',
        'runtime.compaction.error': 'Compaction failed',
        'runtime.fallback.active': 'Using fallback model',
        'runtime.fallback.cleared': 'Fallback cleared',
        'approval.title': 'Approval required',
        'approval.status.pending': 'Pending approval',
        'approval.status.unavailable': 'Approval unavailable',
        'approval.allowOnce': 'Allow once',
        'approval.allowAlways': 'Allow for session',
        'approval.deny': 'Deny',
        'toolCard.show': 'Show',
        'toolCard.hide': 'Hide',
        'toolCard.error': 'Error',
        'toolCard.calling': 'Calling {{tool}}',
        'toolCard.preview': 'Preview',
        'commandCard.title': 'Command',
        'commandCard.exitCode': 'exit {{code}}',
        'commandCard.durationMs': '{{count}} ms',
        'commandCard.durationSeconds': '{{value}} s',
        'thinkingBlock.title': 'Thinking',
        'thinkingBlock.completedTitle': 'Thinking process',
        'composer.slashSkillsHeading': 'Skills',
        'welcome.subtitle': 'What can I do for you?',
        'welcome.askQuestions': 'Handle Tasks',
        'welcome.askQuestionsDesc': 'Work on task-oriented requests',
        'welcome.creativeTasks': 'Continuous Execution',
        'welcome.creativeTasksDesc': 'Keep running through multi-step work',
        'welcome.brainstorming': 'Multi-Agent Parallel',
      };
      const template = values[key] ?? key;
      return Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    media: {
      thumbnails: thumbnailsMock,
    },
    shell: {
      openPath: vi.fn(),
    },
  },
}));

vi.mock('@/lib/file-preview-client', () => ({
  statFile: statFileMock,
}));

describe('ChatSurface', () => {
  beforeEach(() => {
    thumbnailsMock.mockReset();
    thumbnailsMock.mockResolvedValue({});
    statFileMock.mockReset();
    statFileMock.mockResolvedValue({ ok: true, isFile: true, isDir: false, size: 128 });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  it('renders the welcome state for a new empty session', () => {
    render(<ChatSurface items={[]} />);

    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument();
    expect(screen.getByText('What can I do for you?')).toBeInTheDocument();
    expect(screen.getByText('Handle Tasks')).toBeInTheDocument();
    expect(screen.getByText('Continuous Execution')).toBeInTheDocument();
    expect(screen.getByText('Multi-Agent Parallel')).toBeInTheDocument();
  });

  it('renders history messages and live streaming group separately', () => {
    const items: VisibleChatItem[] = [
      { kind: 'message', id: 'u1', message: { id: 'u1', role: 'user', content: 'hello' } },
      { kind: 'stream', id: 'stream-run-1', runId: 'run-1', text: 'working', phase: 'commentary' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-message-bubble')).toHaveClass('bg-primary');
    expect(screen.getByTestId('chat-streaming-group')).toHaveTextContent('working');
  });

  it('keeps live thinking expanded while the model is still thinking', () => {
    const items: VisibleChatItem[] = [
      { kind: 'thinking', id: 'thinking-run-1', runId: 'run-1', text: 'Planning the answer.' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByTestId('chat-thinking-block')).toHaveTextContent('Thinking');
    expect(screen.getByTestId('chat-thinking-block')).toHaveTextContent('Planning the answer.');
    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
  });

  it('merges live thinking into the assistant answer and collapses it after thinking completes', () => {
    const items: VisibleChatItem[] = [
      { kind: 'thinking', id: 'thinking-run-1', runId: 'run-1', text: 'Planning the answer.' },
      { kind: 'stream', id: 'stream-run-1', runId: 'run-1', text: 'Final answer text.', phase: 'final_answer' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByTestId('chat-streaming-group')).toHaveTextContent('Final answer text.');
    expect(screen.getByTestId('chat-thinking-block')).toHaveTextContent('Thinking process');
    expect(screen.queryByText('Planning the answer.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Thinking process/i }));

    expect(screen.getByText('Planning the answer.')).toBeInTheDocument();
  });

  it('renders one assistant row for history thinking followed by the final answer', () => {
    const items: VisibleChatItem[] = [
      { kind: 'thinking', id: 'thinking-history-answer', runId: 'assistant-final', text: 'Check the constraints first.' },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'The final answer is ready.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('The final answer is ready.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-thinking-block')).toHaveTextContent('Thinking process');
    expect(screen.queryByTestId('chat-streaming-group')).not.toBeInTheDocument();
    expect(screen.queryByText('Check the constraints first.')).not.toBeInTheDocument();
  });

  it('keeps a tool-use history turn and its final assistant reply under one avatar', () => {
    const items: VisibleChatItem[] = [
      { kind: 'message', id: 'u1', message: { id: 'u1', role: 'user', content: 'read the file' } },
      { kind: 'thinking', id: 'thinking-tool', runId: 'assistant-tool', text: 'Need to read the file.' },
      {
        kind: 'message',
        id: 'assistant-tool',
        message: {
          id: 'assistant-tool',
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call-1',
            name: 'read',
            arguments: { path: '/tmp/example.txt' },
          }],
          stopReason: 'toolUse',
        },
      },
      {
        kind: 'message',
        id: 'tool-result',
        message: {
          id: 'tool-result',
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: 'TOOL_RESULT' }],
        },
      },
      { kind: 'thinking', id: 'thinking-final', runId: 'assistant-final', text: 'Now answer.' },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Final answer.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('Final answer.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling read');
  });

  it('opens previewable file paths from live tool cards', () => {
    const onOpenFile = vi.fn();
    const items: VisibleChatItem[] = [
      {
        kind: 'tool',
        id: 'tool-run-write',
        runId: 'run-write',
        tool: {
          id: 'tool-card-write',
          toolName: 'write',
          inputText: '{"path":"/workspace/demo.md","content":"# Demo"}',
        },
        status: { phase: 'running', runId: 'run-write' },
      },
    ];

    render(<ChatSurface items={items} onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole('button', { name: /Calling write/i }));
    fireEvent.click(screen.getByTestId('chat-tool-card-preview'));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'demo.md',
      filePath: '/workspace/demo.md',
      mimeType: 'text/markdown',
    }));
  });

  it('opens previewable file paths from history tool cards', () => {
    const onOpenFile = vi.fn();
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-write',
        message: {
          id: 'assistant-write',
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'write-call',
            name: 'write',
            arguments: { path: '/workspace/history-demo.md', content: '# Demo' },
          }],
        },
      },
    ];

    render(<ChatSurface items={items} onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole('button', { name: /Calling write/i }));
    fireEvent.click(screen.getByTestId('chat-tool-card-preview'));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'history-demo.md',
      filePath: '/workspace/history-demo.md',
      mimeType: 'text/markdown',
    }));
  });

  it('opens previewable file paths from merged OpenClaw tool_use and tool_result messages', () => {
    const onOpenFile = vi.fn();
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-read',
        message: {
          id: 'assistant-read',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'read-call',
            name: 'read',
            input: { filePath: '/tmp/a.md' },
          }],
        },
      },
      {
        kind: 'message',
        id: 'read-result',
        message: {
          id: 'read-result',
          role: 'toolResult',
          toolCallId: 'read-call',
          toolName: 'read',
          content: [{ type: 'text', text: 'file contents' }],
        },
      },
    ];

    render(<ChatSurface items={items} onOpenFile={onOpenFile} />);

    expect(screen.getAllByTestId('chat-tool-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Calling read/i }));
    fireEvent.click(screen.getByTestId('chat-tool-card-preview'));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'a.md',
      filePath: '/tmp/a.md',
      mimeType: 'text/markdown',
    }));
  });

  it('opens previewable file cards from grouped assistant history turns', async () => {
    const onOpenFile = vi.fn();
    const items: VisibleChatItem[] = [
      { kind: 'message', id: 'u1', message: { id: 'u1', role: 'user', content: 'create a markdown file' } },
      {
        kind: 'message',
        id: 'tool-result-1',
        message: {
          id: 'tool-result-1',
          role: 'tool',
          toolName: 'write',
          content: 'wrote /workspace/demo.md',
        },
      },
      {
        kind: 'message',
        id: 'assistant-final-1',
        message: {
          id: 'assistant-final-1',
          role: 'assistant',
          content: 'Created /workspace/demo.md',
        },
      },
    ];

    render(<ChatSurface items={items} onOpenFile={onOpenFile} />);

    const fileName = await screen.findByText('demo.md');
    fireEvent.click(fileName.closest('div[class*="cursor-pointer"]')!);

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'demo.md',
      filePath: '/workspace/demo.md',
      mimeType: 'text/markdown',
    }));
  });

  it('keeps live tool calls interleaved between streaming text segments', () => {
    const items: VisibleChatItem[] = [
      { kind: 'stream', id: 'stream-before-tool', runId: 'run-1', text: 'Before tool.', phase: 'commentary' },
      {
        kind: 'tool',
        id: 'tool-run-1',
        runId: 'run-1',
        tool: {
          id: 'tool-card-1',
          toolName: 'exec',
          inputText: '{"command":"ls"}',
        },
        status: { phase: 'running', runId: 'run-1' },
      },
      { kind: 'stream', id: 'stream-after-tool', runId: 'run-1', text: 'After tool.', phase: 'commentary' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByTestId('chat-streaming-group')).toHaveTextContent('Before tool.');
    expect(screen.getByTestId('chat-streaming-group')).toHaveTextContent('After tool.');
    const text = screen.getByTestId('chat-streaming-group').textContent ?? '';
    expect(text.indexOf('Before tool.')).toBeLessThan(text.indexOf('Calling exec'));
    expect(text.indexOf('Calling exec')).toBeLessThan(text.indexOf('After tool.'));
  });

  it('copies interleaved live assistant text as one assistant turn', async () => {
    const items: VisibleChatItem[] = [
      { kind: 'stream', id: 'stream-before-tool', runId: 'run-copy', text: 'Before tool.', phase: 'commentary' },
      {
        kind: 'tool',
        id: 'tool-run-copy',
        runId: 'run-copy',
        tool: {
          id: 'tool-card-copy',
          toolName: 'exec',
          inputText: '{"command":"ls"}',
        },
        status: { phase: 'running', runId: 'run-copy' },
      },
      { kind: 'stream', id: 'stream-after-tool', runId: 'run-copy', text: 'After tool.', phase: 'commentary' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Before tool.\n\nAfter tool.');
    });
  });

  it('merges live exec command output into the tool card and collapses when execution finishes', async () => {
    const runningItems: VisibleChatItem[] = [
      {
        kind: 'tool',
        id: 'tool-run-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        tool: {
          id: 'live:call-1',
          toolName: 'exec',
          inputText: '{"command":"ls -la"}',
        },
        status: { phase: 'running', runId: 'run-1' },
      },
      {
        kind: 'command',
        id: 'command-run-1',
        command: {
          id: 'command-run-1',
          runId: 'run-1',
          toolCallId: 'call-1',
          title: 'command list files',
          command: 'ls -la',
          output: 'total 88',
          status: 'running',
          ts: 1001,
        },
        status: { phase: 'running', runId: 'run-1' },
      },
    ];
    const completedItems: VisibleChatItem[] = [
      runningItems[0],
      {
        kind: 'command',
        id: 'command-run-1',
        command: {
          id: 'command-run-1',
          runId: 'run-1',
          toolCallId: 'call-1',
          title: 'command list files',
          command: 'ls -la',
          output: 'total 88',
          exitCode: 0,
          durationMs: 59,
          status: 'completed',
          ts: 1002,
        },
        status: { phase: 'running', runId: 'run-1' },
      },
    ];

    const { rerender } = render(<ChatSurface items={runningItems} />);

    expect(screen.getAllByTestId('chat-tool-card')).toHaveLength(1);
    expect(screen.queryByTestId('chat-command-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('command list files');
    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('ls -la');
    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('total 88');
    expect(screen.getByRole('button', { name: /Calling exec/i })).toHaveTextContent('Hide');

    rerender(<ChatSurface items={completedItems} />);

    await vi.waitFor(() => {
      expect(screen.queryByTestId('chat-command-card-body')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Calling exec/i })).toHaveTextContent('Show');

    fireEvent.click(screen.getByRole('button', { name: /Calling exec/i }));

    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('command list files');
    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('exit 0');
    expect(screen.getByTestId('chat-command-card-body')).toHaveTextContent('59 ms');
  });

  it('keeps gateway-relative live stream media visible before history hydration', () => {
    const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3Alive/live-image/full';
    const items: VisibleChatItem[] = [
      {
        kind: 'stream',
        id: 'stream-run-media',
        runId: 'run-media',
        text: 'Image generated.',
        phase: 'final_answer',
        mediaUrls: [gatewayUrl],
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Image generated.')).toBeInTheDocument();
    expect(screen.getByTestId('image-preview-loading')).toBeInTheDocument();
  });

  it('keeps raw-percent local live stream media paths visible', async () => {
    const filePath = '/tmp/progress 100% done.png';
    const items: VisibleChatItem[] = [
      {
        kind: 'stream',
        id: 'stream-run-local-percent',
        runId: 'run-local-percent',
        text: 'Local image generated.',
        phase: 'final_answer',
        mediaUrls: [filePath],
      },
    ];

    expect(() => render(<ChatSurface items={items} />)).not.toThrow();
    expect(await screen.findByTestId('image-preview-loading')).toBeInTheDocument();
    expect(statFileMock).toHaveBeenCalledWith(filePath);
  });

  it('normalizes file URL live stream media to filesystem paths', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'stream',
        id: 'stream-run-file-url',
        runId: 'run-file-url',
        text: 'File URL image generated.',
        phase: 'final_answer',
        mediaUrls: ['file:///tmp/live%20image.png'],
      },
    ];

    render(<ChatSurface items={items} />);

    expect(await screen.findByTestId('image-preview-loading')).toBeInTheDocument();
    expect(statFileMock).toHaveBeenCalledWith('/tmp/live image.png');
  });

  it('renders assistant replies as Markdown in the OpenClaw surface', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'a1',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                '### Rendered heading',
                '',
                '- **bold** item',
                '- `inlineCode()` item',
              ].join('\n'),
            },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByRole('heading', { name: 'Rendered heading', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('inlineCode()').tagName).toBe('CODE');
  });

  it('renders assistant replies with the legacy Sparkles avatar, timestamp, and copy action', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'a1',
        message: {
          id: 'a1',
          role: 'assistant',
          timestamp: 1_777_000_000,
          content: [{ type: 'text', text: 'Copyable assistant answer' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByTestId('chat-assistant-avatar')).toBeInTheDocument();
    expect(screen.getByText('Copyable assistant answer')).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copyable assistant answer');
    });
  });

  it('strips OpenClaw inline directive tags from visible assistant text', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'a1',
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Draft answer.\n\n[[reply_to_current]]\n### Final answer' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.queryByText(/\[\[reply_to_current\]\]/)).not.toBeInTheDocument();
    expect(screen.getByText('Draft answer.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Final answer', level: 3 })).toBeInTheDocument();
  });

  it('surfaces message-tool-only source replies with image attachments', async () => {
    const imagePath = '/tmp/puppy.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    thumbnailsMock.mockResolvedValue({ [imagePath]: { preview, fileSize: 68 } });

    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'send-image',
        message: {
          role: 'assistant',
          id: 'send-image',
          content: [
            { type: 'text', text: "I'll deliver the puppy image via the message tool." },
            {
              type: 'toolCall',
              id: 'message-call',
              name: 'message',
              arguments: {
                action: 'send',
                message: 'Puppy ready',
                attachments: [{ type: 'image', path: imagePath, name: 'puppy.png' }],
              },
            },
          ],
        },
      },
      {
        kind: 'message',
        id: 'message-result',
        message: {
          role: 'toolResult',
          id: 'message-result',
          toolCallId: 'message-call',
          toolName: 'message',
          content: [{ type: 'text', text: '{ "status": "ok" }' }],
          details: {
            sourceReplyDeliveryMode: 'message_tool_only',
            sourceReplySink: 'internal-ui',
            sourceReply: {
              text: 'Puppy ready',
              mediaUrl: imagePath,
              mediaUrls: [imagePath],
            },
            mediaUrl: imagePath,
            mediaUrls: [imagePath],
          },
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(await screen.findByText('Puppy ready')).toBeInTheDocument();
    expect(await screen.findByAltText('puppy.png')).toBeInTheDocument();
    expect(screen.queryByText("I'll deliver the puppy image via the message tool.")).not.toBeInTheDocument();
  });

  it('renders media-only assistant history images from source-wrapped base64 content', async () => {
    const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-source-image',
        message: {
          id: 'assistant-source-image',
          role: 'assistant',
          content: [
            { type: 'text', text: 'NO_REPLY' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageData,
              },
            },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    const image = await screen.findByRole('img');
    expect(image).toHaveAttribute('src', `data:image/png;base64,${imageData}`);
    expect(screen.queryByText('NO_REPLY')).not.toBeInTheDocument();
  });

  it('hydrates Windows MEDIA image artifacts without leaking marker text', async () => {
    const filePath = String.raw`C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;
    const preview = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')}`;
    thumbnailsMock.mockResolvedValue({ [filePath]: { preview, fileSize: 73 } });

    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'windows-svg-artifact',
        message: {
          id: 'windows-svg-artifact',
          role: 'assistant',
          content: String.raw`SVG file is ready:

MEDIA:C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`,
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('SVG file is ready:')).toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:C:/)).not.toBeInTheDocument();
    expect(await screen.findByAltText('japan-kansai-4d3n-plan.svg')).toBeInTheDocument();
  });

  it('renders queue items without a full-row running status', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'queue',
        id: 'queue-1',
        item: {
          id: 'send-1',
          sessionKey: 'agent:main:main',
          message: 'queued prompt',
          idempotencyKey: 'idem-1',
          state: 'waiting-reconnect',
        },
      },
      {
        kind: 'status',
        id: 'status-run-1',
        status: { phase: 'running', runId: 'run-1' },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('queued prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-run-status')).not.toBeInTheDocument();
  });

  it('renders attachments on queued optimistic user messages', async () => {
    const filePath = '/tmp/optimistic.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const items: VisibleChatItem[] = [
      {
        kind: 'queue',
        id: 'queue-with-image',
        item: {
          id: 'send-image',
          sessionKey: 'agent:main:main',
          message: 'Describe this image',
          idempotencyKey: 'idem-image',
          state: 'sending',
          createdAt: 1_777_000_000_000,
          attachments: [{
            fileName: 'optimistic.png',
            mimeType: 'image/png',
            fileSize: 68,
            preview,
            filePath,
            source: 'user-upload',
          }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Describe this image')).toBeInTheDocument();
    expect(await screen.findByAltText('optimistic.png')).toBeInTheDocument();
  });

  it('renders attachments from media-suffixed history user messages', async () => {
    const imagePath = '/tmp/history image.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    thumbnailsMock.mockResolvedValue({ [imagePath]: { preview, fileSize: 68 } });
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'history-user-image',
        message: {
          id: 'history-user-image',
          role: 'user',
          content: `Describe this image\n\n[media attached: ${imagePath} (image/png) | ${imagePath}]`,
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Describe this image')).toBeInTheDocument();
    expect(screen.queryByText(/media attached:/i)).not.toBeInTheDocument();
    expect(await screen.findByAltText('history image.png')).toBeInTheDocument();
  });

  it('renders attachments from loose media markers without leaking marker text', async () => {
    const imagePath = '/tmp/loose history image.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    thumbnailsMock.mockResolvedValue({ [imagePath]: { preview, fileSize: 68 } });
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'history-user-loose-image',
        message: {
          id: 'history-user-loose-image',
          role: 'user',
          content: `Describe this image\n\n[MEDIA ATTACHED: ${imagePath}]`,
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Describe this image')).toBeInTheDocument();
    expect(screen.queryByText(/media attached:/i)).not.toBeInTheDocument();
    expect(await screen.findByAltText('loose history image.png')).toBeInTheDocument();
  });

  it('renders user attachments from media paths when history only keeps a media URL marker', async () => {
    const imagePath = '/tmp/inbound-only-image.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    thumbnailsMock.mockResolvedValue({ [imagePath]: { preview, fileSize: 68 } });
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'history-user-media-url-only',
        message: {
          id: 'history-user-media-url-only',
          role: 'user',
          content: 'Describe this image\n\n[media attached: media://inbound/inbound-only-image.png (image/png)]',
          MediaPath: imagePath,
          MediaType: 'image/png',
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Describe this image')).toBeInTheDocument();
    expect(screen.queryByText(/media attached:/i)).not.toBeInTheDocument();
    expect(await screen.findByAltText('inbound-only-image.png')).toBeInTheDocument();
  });

  it('deduplicates OpenClaw inbound and outbound records for one uploaded image', async () => {
    const outboundImage = '/Users/test/.openclaw/media/outbound/015f0a5d-a074-42b3-879d-b5b28ca79af1-qa-red.png';
    const inboundImage = '/Users/test/.openclaw/media/inbound/qa-red---d3fffcba-c0ba-4b5e-ab78-448e65faefa2.png';
    const textPath = '/Users/test/.openclaw/media/outbound/d1428a36-e726-4ded-ad59-22267ae12f2c-qa-note.txt';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    thumbnailsMock.mockResolvedValue({
      [outboundImage]: { preview, fileSize: 68 },
      [inboundImage]: { preview, fileSize: 68 },
    });
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'history-user-duplicated-upload',
        message: {
          id: 'history-user-duplicated-upload',
          role: 'user',
          content: [
            'Describe these attachments',
            '',
            `[media attached: ${outboundImage} (image/png) | ${outboundImage}]`,
            `[media attached: ${textPath} (text/plain) | ${textPath}]`,
          ].join('\n'),
          MediaPath: inboundImage,
          MediaPaths: [inboundImage],
          MediaType: 'image/png',
          MediaTypes: ['image/png'],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Describe these attachments')).toBeInTheDocument();
    expect(screen.queryByText(/media attached:/i)).not.toBeInTheDocument();
    expect(await screen.findByAltText('qa-red.png')).toBeInTheDocument();
    expect(screen.queryAllByAltText('qa-red.png')).toHaveLength(1);
    expect(await screen.findByText('qa-note.txt')).toBeInTheDocument();
    expect(screen.queryByText(/d1428a36/)).not.toBeInTheDocument();
  });

  it('does not leave history image attachments in a permanent loading state when preview generation fails', async () => {
    const imagePath = '/tmp/previewless-image.png';
    thumbnailsMock.mockResolvedValue({ [imagePath]: { preview: null, fileSize: 68 } });
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'history-user-previewless-image',
        message: {
          id: 'history-user-previewless-image',
          role: 'user',
          content: 'Describe this image\n\n[media attached: media://inbound/previewless-image.png (image/png)]',
          MediaPath: imagePath,
          MediaType: 'image/png',
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(await screen.findByTestId('image-preview-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-preview-loading')).not.toBeInTheDocument();
  });

  it('keeps the scroll-to-latest label on one line', async () => {
    const items: VisibleChatItem[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'message' as const,
        id: `u-${index}`,
        message: { id: `u-${index}`, role: 'user', content: `message ${index}` },
      })),
    ];

    render(<ChatSurface items={items} />);
    const scrollContainer = screen.getByTestId('chat-scroll-container');
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 300, configurable: true });

    await act(async () => {
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
    });

    expect(await screen.findByTestId('chat-scroll-to-latest')).toHaveClass('whitespace-nowrap');
  });

  it('clears the scroll-to-latest button when switching to an empty session', async () => {
    const items: VisibleChatItem[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'message' as const,
        id: `u-${index}`,
        message: { id: `u-${index}`, role: 'user', content: `message ${index}` },
      })),
    ];

    const { rerender } = render(<ChatSurface items={items} />);
    const scrollContainer = screen.getByTestId('chat-scroll-container');
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 300, configurable: true });

    await act(async () => {
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
    });

    expect(await screen.findByTestId('chat-scroll-to-latest')).toBeInTheDocument();

    rerender(<ChatSurface items={[]} />);

    expect(screen.queryByTestId('chat-scroll-to-latest')).not.toBeInTheDocument();
  });

  it('keeps scroll detached when a history refresh clamps the container after manual scroll-up', async () => {
    const items: VisibleChatItem[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'message' as const,
        id: `u-${index}`,
        message: { id: `u-${index}`, role: 'user', content: `message ${index}` },
      })),
    ];

    render(<ChatSurface items={items} />);
    const scrollContainer = screen.getByTestId('chat-scroll-container');
    let scrollHeight = 1000;
    let clientHeight = 300;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      get: () => scrollHeight,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      get: () => clientHeight,
      configurable: true,
    });

    await act(async () => {
      scrollContainer.scrollTop = 100;
      fireEvent.scroll(scrollContainer);
    });

    expect(await screen.findByTestId('chat-scroll-to-latest')).toBeInTheDocument();

    await act(async () => {
      scrollHeight = 300;
      clientHeight = 300;
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
    });

    expect(screen.getByTestId('chat-scroll-to-latest')).toBeInTheDocument();
  });

  it('renders tool use and tool result as an expandable tool card', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tools',
        message: {
          id: 'assistant-tools',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/a.md' } },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'file contents' },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling read');
    expect(screen.getByTestId('chat-tool-card-icon')).toBeInTheDocument();
    expect(screen.getByTestId('chat-assistant-avatar')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card').className).toContain('w-[50vw]');
    expect(screen.queryByText('file contents')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Calling read/i }));

    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('/tmp/a.md');
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('file contents');
    expect(screen.queryByRole('button', { name: 'Raw output' })).not.toBeInTheDocument();
  });

  it('renders one assistant row for a history tool call followed by the final answer', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-use',
        message: {
          id: 'assistant-tool-use',
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'exec', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'file list' },
          ],
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the summary.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling exec');
    expect(screen.getByText('Here is the summary.')).toBeInTheDocument();
  });

  it('keeps persisted stream fallback text before a history tool call', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-stream-before-tool',
        message: {
          id: 'assistant-stream-before-tool',
          role: 'assistant',
          content: [{ type: 'text', text: 'First explanation.' }],
          openclawStreamFallback: { replacementText: 'First explanation.' },
        },
      },
      {
        kind: 'message',
        id: 'assistant-tool-use',
        message: {
          id: 'assistant-tool-use',
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'web_search', input: { query: 'tech trends' } },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'search results' },
          ],
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Final explanation.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('First explanation.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling web_search');
    expect(screen.getByText('Final explanation.')).toBeInTheDocument();
  });

  it('renders one assistant row for a live tool card followed by the final answer', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'tool',
        id: 'tool-live-web-search',
        runId: 'run-1',
        toolCallId: 'call-1',
        tool: {
          id: 'tool-card-web-search',
          toolName: 'web_search',
          inputText: '{"query":"xiaomi mimo v2.5 thinking"}',
        },
        status: { phase: 'running', runId: 'run-1' },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'MiMo V2.5 is the standard model.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling web_search');
    expect(screen.getByText('MiMo V2.5 is the standard model.')).toBeInTheDocument();
  });

  it('keeps assistant narration from intermediate tool-use turns in the same assistant row', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-use',
        message: {
          id: 'assistant-tool-use',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'text', text: 'I should inspect the workspace before answering.' },
            { type: 'toolCall', id: 'call-1', name: 'read', input: { filePath: '/tmp/a.md' } },
          ],
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'text', text: '### Final answer\n\n- **Ready**' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('I should inspect the workspace before answering.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling read');
    expect(screen.getByRole('heading', { name: 'Final answer', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Ready').tagName).toBe('STRONG');
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'I should inspect the workspace before answering.\n\n### Final answer\n\n- **Ready**',
      );
    });
  });

  it('keeps explicit commentary text from tool-use history turns in the same assistant row', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-use-commentary',
        message: {
          id: 'assistant-tool-use-commentary',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'text', phase: 'commentary', text: 'First explanation before the lookup.' },
            { type: 'toolCall', id: 'call-1', name: 'web_search', arguments: { query: 'tech trends' } },
          ],
        },
      },
      {
        kind: 'message',
        id: 'tool-result',
        message: {
          id: 'tool-result',
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: [{ type: 'text', text: 'search results' }],
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', phase: 'final_answer', text: 'Third explanation after the lookup.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('First explanation before the lookup.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling web_search');
    expect(screen.queryByText('search results')).not.toBeInTheDocument();
    expect(screen.getByText('Third explanation after the lookup.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'First explanation before the lookup.\n\nThird explanation after the lookup.',
      );
    });
  });

  it('keeps assistant narration from tool-call messages without stopReason', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-use-no-stop',
        message: {
          id: 'assistant-tool-use-no-stop',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check one more file before answering.' },
            { type: 'toolCall', id: 'call-1', name: 'read', input: { filePath: '/tmp/b.md' } },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('Let me check one more file before answering.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling read');
  });

  it('keeps assistant narration split before a tool-call message in the same assistant row', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-narration',
        message: {
          id: 'assistant-narration',
          role: 'assistant',
          content: [{ type: 'text', text: 'I need to inspect the workspace first.' }],
        },
      },
      {
        kind: 'message',
        id: 'assistant-tool-call',
        message: {
          id: 'assistant-tool-call',
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'read', input: { filePath: '/tmp/c.md' } },
          ],
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Final response.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('I need to inspect the workspace first.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling read');
    expect(screen.getByText('Final response.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'I need to inspect the workspace first.\n\nFinal response.',
      );
    });
  });

  it('keeps assistant narration split before a standalone tool-result card', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-narration',
        message: {
          id: 'assistant-narration',
          role: 'assistant',
          content: [{ type: 'text', text: 'The lookup failed, so I will read the file.' }],
        },
      },
      {
        kind: 'message',
        id: 'tool-result',
        message: {
          id: 'tool-result',
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: '{"status":"error"}' }],
          isError: true,
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('The lookup failed, so I will read the file.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('read');
  });

  it('dedupes gateway fallback text after a history tool-use turn', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-use',
        message: {
          id: 'assistant-tool-use',
          role: 'assistant',
          stopReason: 'toolUse',
          content: [
            { type: 'text', text: 'First explanation.' },
            { type: 'toolCall', id: 'call-1', name: 'web_search', input: { query: 'tech trends' } },
          ],
        },
      },
      {
        kind: 'message',
        id: 'tool-result',
        message: {
          id: 'tool-result',
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: [{ type: 'text', text: 'search results' }],
        },
      },
      {
        kind: 'message',
        id: 'assistant-gateway-fallback',
        message: {
          id: 'assistant-gateway-fallback',
          role: 'assistant',
          content: [{ type: 'text', text: 'First explanation.' }],
          openclawStreamFallback: { replacementText: 'First explanation.' },
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Final explanation.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getAllByText('First explanation.')).toHaveLength(1);
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling web_search');
    expect(screen.getByText('Final explanation.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'First explanation.\n\nFinal explanation.',
      );
    });
  });

  it('renders stream fallback, standalone tool result, and final text as one assistant turn', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-stream-before-tool',
        message: {
          id: 'assistant-stream-before-tool',
          role: 'assistant',
          content: [{ type: 'text', text: 'First explanation.' }],
          openclawStreamFallback: {
            replacementText: 'First explanation.',
            beforeToolIds: ['call-1'],
          },
        },
      },
      {
        kind: 'message',
        id: 'assistant-tool-call',
        message: {
          id: 'assistant-tool-call',
          role: 'assistant',
          content: [
            { type: 'tool_call', id: 'call-1', name: 'web_search', input: { query: 'tech trends' } },
          ],
        },
      },
      {
        kind: 'message',
        id: 'standalone-tool-result',
        message: {
          id: 'standalone-tool-result',
          role: 'tool_result',
          tool_call_id: 'call-1',
          content: 'search results',
        },
      },
      {
        kind: 'message',
        id: 'assistant-final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'Third explanation.' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-assistant-avatar')).toHaveLength(1);
    expect(screen.getByText('First explanation.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('Calling web_search');
    expect(screen.queryByText('search results')).not.toBeInTheDocument();
    expect(screen.getByText('Third explanation.')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-assistant-copy')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('chat-assistant-copy'));

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'First explanation.\n\nThird explanation.',
      );
    });
  });

  it('merges adjacent OpenClaw tool call and result messages into one card', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-call',
        message: {
          id: 'assistant-tool-call',
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'exec',
              arguments: { command: 'date +%Y-%m-%d' },
            },
          ],
        },
      },
      {
        kind: 'message',
        id: 'tool-result',
        message: {
          id: 'tool-result',
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'exec',
          content: [{ type: 'text', text: '2026-06-19' }],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getAllByTestId('chat-tool-card')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Calling exec/i }));
    expect(screen.getByTestId('chat-command-card-body')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('date +%Y-%m-%d');
    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('2026-06-19');
    expect(screen.getByTestId('chat-tool-card')).not.toHaveTextContent('"command"');
    expect(screen.queryAllByText('2026-06-19')).toHaveLength(1);
  });

  it('marks failed tool cards in the collapsed header', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tool-error',
        message: {
          id: 'assistant-tool-error',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call-1', name: 'image', input: { image: '/tmp/sample.png' } },
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              content: JSON.stringify({ status: 'error', error: 'invalid image' }),
            },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    const card = screen.getByTestId('chat-tool-card');
    expect(card).toHaveTextContent('Calling image');
    expect(card).toHaveTextContent('Error');
    expect(card.className).toContain('border-destructive');
  });

  it('renders runtime indicators and approval actions', () => {
    const onResolveApproval = vi.fn();
    const items = [
      {
        kind: 'runtime',
        id: 'runtime-compaction',
        status: { kind: 'compaction', phase: 'active', message: 'Memory pressure detected' },
      },
      {
        kind: 'runtime',
        id: 'runtime-fallback',
        status: { kind: 'fallback', phase: 'active', message: 'Trying fallback model' },
      },
      {
        kind: 'approval',
        id: 'approval-1',
        approval: {
          id: 'approval-1',
          kind: 'exec',
          status: 'pending',
          title: 'Command approval requested',
          detail: 'git status',
          allowedDecisions: ['allow-once', 'deny'],
        },
      },
    ] as VisibleChatItem[];

    render(<ChatSurface items={items} onResolveApproval={onResolveApproval} />);

    expect(screen.getByText('Compacting context')).toBeInTheDocument();
    expect(screen.getByText('Memory pressure detected')).toBeInTheDocument();
    expect(screen.getByText('Trying fallback model')).toBeInTheDocument();
    expect(screen.getByText('Command approval requested')).toBeInTheDocument();
    expect(screen.getByText('git status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(screen.queryByRole('button', { name: 'Allow for session' })).not.toBeInTheDocument();
    expect(onResolveApproval).toHaveBeenNthCalledWith(1, 'approval-1', 'allow-once');
    expect(onResolveApproval).toHaveBeenNthCalledWith(2, 'approval-1', 'deny');
  });

  it('shows a non-interactive skills heading in slash menu', () => {
    render(
      <ChatComposer
        disabled={false}
        sending={false}
        onSend={() => undefined}
        onStop={() => undefined}
        skills={[{ name: 'create-skill', description: 'Create reusable skills' }]}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-composer-input'), { target: { value: '/' } });

    expect(screen.getByRole('listbox', { name: /slash/i })).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.queryByText('/skills')).not.toBeInTheDocument();
    expect(screen.getByText('/skill create-skill')).toBeInTheDocument();
  });
});
