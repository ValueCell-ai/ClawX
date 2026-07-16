import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpToolCallCard } from '@/pages/Chat/AcpToolCallCard';
import { AcpTimeline } from '@/pages/Chat/AcpTimeline';
import type { AcpTimelineSnapshot, ToolCallItem } from '@/lib/acp/timeline-types';
import type { AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { useArtifactPanel } from '@/stores/artifact-panel';

const openAttachmentMock = vi.hoisted(() => vi.fn());
const thumbnailsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: {
      openAttachment: openAttachmentMock,
    },
    media: {
      thumbnails: thumbnailsMock,
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'acp.thought': 'Thought',
        'acp.tool': 'Tool',
        'acp.expandTool': 'Expand tool result',
        'acp.collapseTool': 'Collapse tool result',
        'acp.permission': 'Permission',
        'acp.plan': 'Plan',
        'acp.running': 'Running',
        'acp.pending': 'Pending',
        'acp.completed': 'Completed',
        'acp.failed': 'Failed',
        'acp.cancelled': 'Cancelled',
        'acp.loadFailed': 'Load failed',
        'acp.promptFailed': 'Prompt failed',
        'acp.unsupportedContent': 'Unsupported content',
        'acp.dismiss': 'Dismiss',
        'acp.attachment.loading': 'Loading attachment',
        'acp.attachment.unavailable': 'Attachment unavailable',
        'acp.attachment.open': 'Open {{name}}',
        'acp.attachment.preview': 'Preview {{name}}',
        'acp.attachment.openFailed': 'Could not open attachment',
        'fileActivity.created': 'Created',
        'fileActivity.modified': 'Modified',
        'fileActivity.deleted': 'Deleted',
        'fileActivity.fileButton': '{{action}} {{path}}',
        'fileActivity.changeRecord': 'View changes for {{path}}',
      };
      return (labels[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

function snapshot(overrides: Partial<AcpTimelineSnapshot>): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:s1',
    loadGeneration: 1,
    itemOrder: [],
    itemsById: {},
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
    ...overrides,
  };
}

function toolCallItem(overrides: Partial<ToolCallItem>): ToolCallItem {
  return {
    kind: 'tool-call',
    id: 'tool:read-file',
    toolCallId: 'read-file',
    title: 'Read file',
    status: 'completed',
    outputParts: [{ kind: 'markdown', text: 'File contents loaded.' }],
    locations: [],
    ...overrides,
  };
}

describe('ACP chat timeline components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAttachmentMock.mockResolvedValue({ ok: true });
    thumbnailsMock.mockResolvedValue({});
    useArtifactPanel.setState({ open: false, tab: 'changes', focusedFile: null });
  });

  it('does not apply background highlighting to chat code', () => {
    const state = snapshot({
      itemOrder: ['msg-a:0'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment',
          id: 'msg-a:0',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 0,
          parts: [{ kind: 'markdown', text: '```\nAGENTS\n├── raw/\n└── wiki/\n```\n\nand `inline`' }],
        },
      },
    });

    const { container } = render(<AcpTimeline snapshot={state} />);
    const blockCode = container.querySelector('pre code');
    const inlineCode = Array.from(container.querySelectorAll('code')).find((element) => element.textContent === 'inline');

    expect(blockCode).not.toHaveClass('bg-black/5');
    expect(inlineCode).not.toHaveClass('bg-black/5');
  });

  it('renders tool-only turn file controls once after timeline items and routes preview and changes', () => {
    const state = snapshot({
      itemOrder: ['tool:write-file'],
      itemsById: {
        'tool:write-file': toolCallItem({
          id: 'tool:write-file',
          toolCallId: 'write-file',
          title: 'write: report',
          input: { path: 'report.md', content: '# Report' },
        }),
      },
    });
    const turnId = 'assistant-turn:tool:write-file';
    const activity = {
      turnId,
      toolCallId: 'write-file',
      toolName: 'write' as const,
      relativePath: 'report.md',
      action: 'created' as const,
      fragments: [{ oldText: '', newText: '# Report', sequence: 0 }],
      sequence: 0,
    };
    const projection: AcpFileActivityProjection = {
      activities: [activity],
      turnSummariesByTurnId: {
        [turnId]: [{
          turnId,
          relativePath: 'report.md',
          action: 'created',
          activities: [activity],
          added: 1,
          removed: 0,
        }],
      },
      fileGroups: [{ relativePath: 'report.md', activities: [activity] }],
      uniqueFileCount: 1,
    };

    render(<AcpTimeline snapshot={state} fileActivity={projection} workspaceRoot="/workspace" />);

    const turn = screen.getByTestId('acp-assistant-turn');
    const tool = screen.getByTestId('acp-tool-call-card');
    const controls = screen.getByTestId('acp-turn-file-activity');
    expect(tool.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('acp-file-button')).toHaveLength(1);
    expect(screen.getAllByTestId('acp-file-summary-row')).toHaveLength(1);
    expect(turn).toHaveTextContent('Created');
    expect(turn).toHaveTextContent('+1');
    expect(turn).toHaveTextContent('-0');

    fireEvent.click(screen.getByTestId('acp-file-button'));
    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      filePath: 'report.md',
      workspaceFileRef: { workspaceRoot: '/workspace', relativePath: 'report.md' },
    });
    fireEvent.click(screen.getByTestId('acp-file-summary-row'));
    expect(useArtifactPanel.getState().focusedChange).toMatchObject({
      relativePath: 'report.md',
      turnId,
      navigationId: expect.any(Number),
    });
  });

  it('routes deleted path-only activity to Changes without rendering counts', () => {
    const state = snapshot({
      itemOrder: ['tool:delete-file'],
      itemsById: { 'tool:delete-file': toolCallItem({ id: 'tool:delete-file', toolCallId: 'delete-file' }) },
    });
    const turnId = 'assistant-turn:tool:delete-file';
    const activity = {
      turnId,
      toolCallId: 'delete-file',
      toolName: 'apply_patch' as const,
      relativePath: 'old.md',
      action: 'deleted' as const,
      fragments: [],
      sequence: 0,
    };
    const projection: AcpFileActivityProjection = {
      activities: [activity],
      turnSummariesByTurnId: {
        [turnId]: [{ turnId, relativePath: 'old.md', action: 'deleted', activities: [activity], added: null, removed: null }],
      },
      fileGroups: [{ relativePath: 'old.md', activities: [activity] }],
      uniqueFileCount: 1,
    };

    render(<AcpTimeline snapshot={state} fileActivity={projection} workspaceRoot="/workspace" />);
    expect(screen.getByTestId('acp-turn-file-activity')).not.toHaveTextContent('+');
    expect(screen.getByTestId('acp-turn-file-activity')).not.toHaveTextContent('-');
    fireEvent.click(screen.getByTestId('acp-file-button'));
    expect(useArtifactPanel.getState().focusedChange).toMatchObject({
      relativePath: 'old.md',
      turnId,
      navigationId: expect.any(Number),
    });
  });

  it('renders process blocks between assistant text segments in timeline order', () => {
    const state = snapshot({
      itemOrder: ['msg-a:0', 'thought:msg-a', 'tool:read-file', 'plan:current', 'msg-a:1'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment',
          id: 'msg-a:0',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'First assistant segment.' }],
        },
        'thought:msg-a': {
          kind: 'thought',
          id: 'thought:msg-a',
          messageId: 'msg-a',
          parts: [{ kind: 'markdown', text: 'Need to inspect the file.' }],
        },
        'tool:read-file': {
          kind: 'tool-call',
          id: 'tool:read-file',
          toolCallId: 'read-file',
          title: 'Read file',
          status: 'completed',
          outputParts: [{ kind: 'markdown', text: 'File contents loaded.' }],
          locations: [],
        },
        'plan:current': {
          kind: 'plan',
          id: 'plan:current',
          entries: [{ content: 'Update component tests', status: 'pending' } as never],
        },
        'msg-a:1': {
          kind: 'message-segment',
          id: 'msg-a:1',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 1,
          parts: [{ kind: 'markdown', text: 'Second assistant segment.' }],
        },
      },
    });

    const { container } = render(<AcpTimeline snapshot={state} />);

    expect(screen.getByTestId('acp-chat-timeline')).toBe(container.firstElementChild);
    expect(Array.from(container.querySelectorAll('[data-acp-item-id]')).map((node) => node.getAttribute('data-acp-item-id'))).toEqual([
      'msg-a:0',
      'thought:msg-a',
      'tool:read-file',
      'plan:current',
      'msg-a:1',
    ]);
    expect(screen.getByText('First assistant segment.')).toBeInTheDocument();
    expect(screen.getByTestId('acp-thought-block')).toHaveTextContent('Need to inspect the file.');
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('File contents loaded.');
    expect(screen.getByTestId('acp-plan-item')).toHaveTextContent('Update component tests');
    expect(screen.getByText('Second assistant segment.')).toBeInTheDocument();
  });

  it('keeps completed tool results expanded until the delayed auto-collapse runs', () => {
    vi.useFakeTimers();
    try {
      const state = snapshot({
        itemOrder: ['tool:read-file'],
        itemsById: {
          'tool:read-file': {
            kind: 'tool-call',
            id: 'tool:read-file',
            toolCallId: 'read-file',
            title: 'Read file',
            status: 'completed',
            outputParts: [{ kind: 'markdown', text: 'File contents loaded.' }],
            locations: [],
          },
        },
      });

      render(<AcpTimeline snapshot={state} />);

      const card = screen.getByTestId('acp-tool-call-card');
      expect(card).toHaveAttribute('data-expanded', 'true');
      expect(screen.getByTestId('acp-tool-output-pre')).toHaveTextContent('File contents loaded.');

      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mounts historical completed tool results collapsed without waiting for auto-collapse', () => {
    vi.useFakeTimers();
    try {
      render(<AcpToolCallCard item={toolCallItem({ historical: true } as Partial<ToolCallItem>)} />);

      const card = screen.getByTestId('acp-tool-call-card');
      expect(card).toHaveAttribute('data-expanded', 'false');

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-collapses failed tool results on the same delay as completed ones', () => {
    vi.useFakeTimers();
    try {
      render(<AcpToolCallCard item={toolCallItem({ status: 'failed', error: 'Boom.' })} />);

      const card = screen.getByTestId('acp-tool-call-card');
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mounts historical failed tool results collapsed without waiting for auto-collapse', () => {
    vi.useFakeTimers();
    try {
      render(<AcpToolCallCard item={toolCallItem({ status: 'failed', error: 'Boom.', historical: true })} />);

      const card = screen.getByTestId('acp-tool-call-card');
      expect(card).toHaveAttribute('data-expanded', 'false');

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a fresh delayed auto-collapse when a completed tool call id changes', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<AcpToolCallCard item={toolCallItem({ toolCallId: 'read-file-1' })} />);

      act(() => {
        vi.advanceTimersByTime(500);
      });

      rerender(<AcpToolCallCard item={toolCallItem({ id: 'tool:read-file-2', toolCallId: 'read-file-2', title: 'Read file again' })} />);

      const card = screen.getByTestId('acp-tool-call-card');
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders no-detail tool calls without an expandable toggle button', () => {
    render(<AcpToolCallCard item={toolCallItem({ status: 'running', outputParts: [] })} />);

    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('Read file');
    expect(screen.queryByTestId('acp-tool-toggle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts auto-collapse when details are added to a completed no-detail tool call', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<AcpToolCallCard item={toolCallItem({ outputParts: [] })} />);
      const card = screen.getByTestId('acp-tool-call-card');

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(card).toHaveAttribute('data-expanded', 'true');

      rerender(<AcpToolCallCard item={toolCallItem({ outputParts: [{ kind: 'markdown', text: 'Details arrived.' }] })} />);
      expect(card).toHaveAttribute('data-expanded', 'true');
      expect(screen.getByTestId('acp-tool-output-pre')).toHaveTextContent('Details arrived.');

      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(card).toHaveAttribute('data-expanded', 'true');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(card).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('invokes the permission callback with requestId and optionId', () => {
    const onPermissionSelect = vi.fn();
    const state = snapshot({
      itemOrder: ['permission:req-1'],
      itemsById: {
        'permission:req-1': {
          kind: 'permission',
          id: 'permission:req-1',
          requestId: 'req-1',
          toolCallId: 'tool-1',
          title: 'Allow file write?',
          status: 'pending',
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow' },
            { optionId: 'deny', name: 'Deny', kind: 'reject' },
          ],
        },
      },
    });

    render(<AcpTimeline snapshot={state} onPermissionSelect={onPermissionSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(onPermissionSelect).toHaveBeenCalledWith('req-1', 'allow_once');
  });

  it('renders image render parts', () => {
    const state = snapshot({
      itemOrder: ['msg-a:0'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment',
          id: 'msg-a:0',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 0,
          parts: [{ kind: 'image', source: 'data:image/png;base64,abc', mimeType: 'image/png', alt: 'Chart preview' }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);

    expect(screen.getByTestId('acp-image-part')).toBeInTheDocument();
    expect(screen.getByAltText('Chart preview')).toHaveAttribute('src', 'data:image/png;base64,abc');
  });

  it('renders pending and unavailable attachments as disabled paperclip rows', () => {
    const state = snapshot({
      itemOrder: ['msg-a:0', 'msg-a:1'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment',
          id: 'msg-a:0',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 0,
          parts: [{
            kind: 'attachment',
            attachmentId: 'attachment:msg-a:0:0',
            reference: { uri: 'file:///repo/report.txt', name: '/repo/report.txt', mimeType: 'text/plain' },
            source: 'acp-resource',
            access: { status: 'pending' },
          }],
        },
        'msg-a:1': {
          kind: 'message-segment',
          id: 'msg-a:1',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 1,
          parts: [{
            kind: 'attachment',
            attachmentId: 'attachment:msg-a:1:0',
            reference: { uri: 'file:///secret/missing.zip', name: 'missing.zip' },
            source: 'acp-resource',
            access: { status: 'unavailable', reason: 'operationFailed' },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);

    expect(screen.getByText('report.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading attachment: report.txt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Attachment unavailable: missing.zip' })).toBeDisabled();
    expect(screen.getAllByTestId('acp-attachment-icon')).toHaveLength(2);
    expect(screen.queryByText('file:///secret/missing.zip')).not.toBeInTheDocument();
  });

  it('previews a supported attachment with safe metadata and native button semantics', async () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///secret/budget.xlsx' };
    const state = snapshot({
      itemOrder: ['msg-a:0'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment',
          id: 'msg-a:0',
          role: 'assistant',
          messageId: 'msg-a',
          segmentIndex: 0,
          parts: [{
            kind: 'attachment',
            attachmentId: 'attachment:msg-a:0:0',
            reference: { uri: ref.uri, name: 'budget.xlsx' },
            source: 'acp-resource',
            access: {
              status: 'available',
              identity: 'opaque-budget',
              target: { kind: 'local', scope: 'workspace', ref },
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: 2048,
            },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);

    const button = screen.getByRole('button', { name: 'Preview budget.xlsx' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveClass('focus-visible:ring-2');
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(button).not.toHaveAttribute('title', expect.stringContaining('/secret/'));

    button.focus();
    fireEvent.click(button);

    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      filePath: 'budget.xlsx',
      fileName: 'budget.xlsx',
      attachmentFileRef: ref,
    });
    expect(openAttachmentMock).not.toHaveBeenCalled();
  });

  it.each([
    ['archive.zip', 'application/zip', 1024],
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024],
    ['clip.mp3', 'audio/mpeg', 1024],
    ['movie.mp4', 'video/mp4', 1024],
    ['large.pdf', 'application/pdf', 50 * 1024 * 1024 + 1],
  ])('opens unsupported or oversized local attachment %s through files.openAttachment', async (name, mimeType, size) => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: `file:///workspace/${name}` };
    const state = snapshot({
      itemOrder: ['msg-a:0'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment', id: 'msg-a:0', role: 'assistant', messageId: 'msg-a', segmentIndex: 0,
          parts: [{
            kind: 'attachment', attachmentId: `attachment:${name}`, reference: { uri: ref.uri, name }, source: 'acp-resource',
            access: { status: 'available', identity: `opaque-${name}`, target: { kind: 'local', scope: 'workspace', ref }, mimeType, size },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);
    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }));

    await waitFor(() => expect(openAttachmentMock).toHaveBeenCalledWith(ref));
    expect(useArtifactPanel.getState().focusedFile).toBeNull();
  });

  it.each(['http://example.com/report.pdf', 'https://example.com/report.pdf'])('routes %s through files.openAttachment', async (url) => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: url };
    const state = snapshot({
      itemOrder: ['msg-a:0'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment', id: 'msg-a:0', role: 'assistant', messageId: 'msg-a', segmentIndex: 0,
          parts: [{
            kind: 'attachment', attachmentId: 'attachment:remote', reference: { uri: ref.uri, name: 'report.pdf' }, source: 'acp-resource',
            access: { status: 'available', identity: 'opaque-remote', target: { kind: 'remote', ref, url: ref.uri }, mimeType: 'application/pdf', size: 1024 },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }));

    await waitFor(() => expect(openAttachmentMock).toHaveBeenCalledWith(ref));
  });

  it('lifts early assistant attachments after later process and prose items and before file activity', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///workspace/report.txt' };
    const state = snapshot({
      itemOrder: ['msg-a:0', 'tool:read-file', 'msg-a:1'],
      itemsById: {
        'msg-a:0': {
          kind: 'message-segment', id: 'msg-a:0', role: 'assistant', messageId: 'msg-a', segmentIndex: 0,
          parts: [
            { kind: 'markdown', text: 'First prose.' },
            { kind: 'attachment', attachmentId: 'attachment:early', reference: { uri: ref.uri, name: 'report.txt' }, source: 'acp-resource', access: { status: 'available', identity: 'opaque-report', target: { kind: 'local', scope: 'workspace', ref }, mimeType: 'text/plain', size: 12 } },
          ],
        },
        'tool:read-file': toolCallItem({ id: 'tool:read-file', toolCallId: 'read-file' }),
        'msg-a:1': {
          kind: 'message-segment', id: 'msg-a:1', role: 'assistant', messageId: 'msg-a', segmentIndex: 1,
          parts: [{ kind: 'markdown', text: 'Final prose.' }],
        },
      },
    });
    const turnId = 'assistant-turn:msg-a:0';
    const activity: AcpFileActivityProjection = {
      activities: [],
      turnSummariesByTurnId: {
        [turnId]: [{ turnId, relativePath: 'changed.txt', action: 'modified', activities: [], added: 1, removed: 0 }],
      },
      fileGroups: [],
      uniqueFileCount: 1,
    };

    const { container } = render(<AcpTimeline snapshot={state} fileActivity={activity} workspaceRoot="/workspace" />);
    const tool = screen.getByTestId('acp-tool-call-card');
    const finalProse = screen.getByText('Final prose.');
    const attachment = screen.getByRole('button', { name: 'Preview report.txt' });
    const fileActivity = screen.getByTestId('acp-turn-file-activity');
    const ordered = [tool, finalProse, attachment, fileActivity].map((node) => Array.from(container.querySelectorAll('*')).indexOf(node));
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(screen.getAllByText('report.txt')).toHaveLength(1);
  });

  it('renders user attachments after all prose in the user message', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///workspace/notes.txt', stagingId: 'stage-1' };
    const state = snapshot({
      itemOrder: ['msg-u:0'],
      itemsById: {
        'msg-u:0': {
          kind: 'message-segment', id: 'msg-u:0', role: 'user', messageId: 'msg-u', segmentIndex: 0,
          parts: [
            { kind: 'attachment', attachmentId: 'attachment:user', reference: { uri: ref.uri, name: 'notes.txt' }, source: 'acp-resource', access: { status: 'available', identity: 'opaque-notes', target: { kind: 'local', scope: 'staging', ref }, mimeType: 'text/plain', size: 12 } },
            { kind: 'markdown', text: 'Please review this file.' },
          ],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);
    const prose = screen.getByText('Please review this file.');
    const attachment = screen.getByRole('button', { name: 'Preview notes.txt' });
    expect(prose.compareDocumentPosition(attachment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a user image attachment as a thumbnail with a filename hover overlay', async () => {
    const ref = {
      sessionKey: 'agent:main:s1', generation: 1, uri: '/tmp/clawx-staging/photo.png', stagingId: 'stage-photo',
    };
    thumbnailsMock.mockResolvedValueOnce({
      'opaque-photo': {
        preview: 'data:image/png;base64,iVBORw0KGgo=',
        fileSize: 4,
      },
    });
    const state = snapshot({
      itemOrder: ['msg-u:0'],
      itemsById: {
        'msg-u:0': {
          kind: 'message-segment', id: 'msg-u:0', role: 'user', messageId: 'msg-u', segmentIndex: 0,
          parts: [{
            kind: 'attachment', attachmentId: 'attachment:user-photo',
            reference: {
              uri: ref.uri,
              name: 'photo.png',
              displayPath: '/Users/test/Pictures/photo.png',
              mimeType: 'image/png',
              stagingId: 'stage-photo',
            },
            source: 'acp-resource',
            access: {
              status: 'available', identity: 'opaque-photo',
              target: { kind: 'local', scope: 'staging', ref }, mimeType: 'image/png', size: 4,
            },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);

    const thumbnail = await screen.findByTestId('acp-user-image-attachment');
    expect(thumbnail).toHaveAttribute('alt', 'photo.png');
    expect(thumbnail).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByTestId('acp-user-image-overlay')).toHaveTextContent('photo.png');
    expect(thumbnail.parentElement?.parentElement).toHaveClass('items-end');
    expect(thumbnailsMock).toHaveBeenCalledWith({
      paths: [{ attachmentFileRef: ref, key: 'opaque-photo', mimeType: 'image/png' }],
    });
    expect(screen.queryByTestId('acp-attachment-icon')).not.toBeInTheDocument();
  });

  it('shows a user file path after its name without MIME or size and keeps preview routing', () => {
    const ref = {
      sessionKey: 'agent:main:s1', generation: 1, uri: '/tmp/clawx-staging/notes.txt', stagingId: 'stage-notes',
    };
    const state = snapshot({
      itemOrder: ['msg-u:0'],
      itemsById: {
        'msg-u:0': {
          kind: 'message-segment', id: 'msg-u:0', role: 'user', messageId: 'msg-u', segmentIndex: 0,
          parts: [{
            kind: 'attachment', attachmentId: 'attachment:user-notes',
            reference: {
              uri: ref.uri,
              name: 'notes.txt',
              displayPath: '/Users/test/Documents/a/very/long/path/notes.txt',
              mimeType: 'text/plain',
              stagingId: 'stage-notes',
            },
            source: 'acp-resource',
            access: {
              status: 'available', identity: 'opaque-notes',
              target: { kind: 'local', scope: 'staging', ref }, mimeType: 'text/plain', size: 2048,
            },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);

    const button = screen.getByRole('button', { name: 'Preview notes.txt' });
    const path = screen.getByTestId('acp-user-attachment-path');
    expect(path).toHaveTextContent('/Users/test/Documents/a/very/long/path/notes.txt');
    expect(path).toHaveClass('truncate', 'text-muted-foreground');
    expect(button).not.toHaveTextContent('2.0 KB');
    expect(button).not.toHaveTextContent('text/plain');

    fireEvent.click(button);
    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      fileName: 'notes.txt',
      attachmentFileRef: ref,
    });
  });

  it('opens an unsupported user file through the scoped system-open route', async () => {
    const ref = {
      sessionKey: 'agent:main:s1', generation: 1, uri: '/tmp/clawx-staging/archive.zip', stagingId: 'stage-zip',
    };
    const state = snapshot({
      itemOrder: ['msg-u:0'],
      itemsById: {
        'msg-u:0': {
          kind: 'message-segment', id: 'msg-u:0', role: 'user', messageId: 'msg-u', segmentIndex: 0,
          parts: [{
            kind: 'attachment', attachmentId: 'attachment:user-zip',
            reference: {
              uri: ref.uri, name: 'archive.zip', displayPath: '/Users/test/Downloads/archive.zip', stagingId: 'stage-zip',
            },
            source: 'acp-resource',
            access: {
              status: 'available', identity: 'opaque-zip',
              target: { kind: 'local', scope: 'staging', ref }, mimeType: 'application/zip', size: 128,
            },
          }],
        },
      },
    });

    render(<AcpTimeline snapshot={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open archive.zip' }));

    await waitFor(() => expect(openAttachmentMock).toHaveBeenCalledWith(ref));
    expect(useArtifactPanel.getState().focusedFile).toBeNull();
  });

  it('renders thought and collapsed-tool attachments once after all assistant items', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///workspace/file.txt' };
    const attachment = (attachmentId: string, name: string) => ({
      kind: 'attachment' as const,
      attachmentId,
      reference: { uri: ref.uri, name },
      source: 'acp-resource' as const,
      access: {
        status: 'available' as const,
        identity: `opaque-${attachmentId}`,
        target: { kind: 'local' as const, scope: 'workspace' as const, ref },
        mimeType: 'text/plain',
        size: 12,
      },
    });
    const state = snapshot({
      itemOrder: ['thought:msg-a', 'tool:read', 'msg-a:1'],
      itemsById: {
        'thought:msg-a': {
          kind: 'thought', id: 'thought:msg-a', messageId: 'msg-a',
          parts: [{ kind: 'markdown', text: 'Inspecting.' }, attachment('thought-file', 'thought.txt')],
        },
        'tool:read': {
          kind: 'tool-call', id: 'tool:read', toolCallId: 'read', title: 'Read file', status: 'completed', historical: true,
          outputParts: [{ kind: 'markdown', text: 'Hidden tool output.' }, attachment('tool-file', 'tool.txt')], locations: [],
        },
        'msg-a:1': {
          kind: 'message-segment', id: 'msg-a:1', role: 'assistant', messageId: 'msg-a', segmentIndex: 1,
          parts: [{ kind: 'markdown', text: 'Final answer.' }],
        },
      },
    });

    const { container } = render(<AcpTimeline snapshot={state} />);
    expect(screen.getByTestId('acp-tool-call-card')).toHaveAttribute('data-expanded', 'false');
    const ordered = [
      screen.getByTestId('acp-thought-block'),
      screen.getByTestId('acp-tool-call-card'),
      screen.getByText('Final answer.'),
      screen.getByRole('button', { name: 'Preview thought.txt' }),
      screen.getByRole('button', { name: 'Preview tool.txt' }),
    ].map((node) => Array.from(container.querySelectorAll('*')).indexOf(node));
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(screen.getAllByTestId('acp-attachment-icon')).toHaveLength(2);
  });

  it('renders all user prose segments before the group attachment list', () => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///workspace/file.txt', stagingId: 'stage-1' };
    const attachment = (attachmentId: string, name: string) => ({
      kind: 'attachment' as const,
      attachmentId,
      reference: { uri: ref.uri, name },
      source: 'acp-resource' as const,
      access: {
        status: 'available' as const,
        identity: `opaque-${attachmentId}`,
        target: { kind: 'local' as const, scope: 'staging' as const, ref },
        mimeType: 'text/plain',
        size: 12,
      },
    });
    const state = snapshot({
      itemOrder: ['msg-u:0', 'msg-u:1'],
      itemsById: {
        'msg-u:0': {
          kind: 'message-segment', id: 'msg-u:0', role: 'user', messageId: 'msg-u', segmentIndex: 0,
          parts: [attachment('user-a', 'a.txt'), { kind: 'markdown', text: 'First user prose.' }],
        },
        'msg-u:1': {
          kind: 'message-segment', id: 'msg-u:1', role: 'user', messageId: 'msg-u', segmentIndex: 1,
          parts: [{ kind: 'markdown', text: 'Second user prose.' }, attachment('user-b', 'b.txt')],
        },
      },
    });

    const { container } = render(<AcpTimeline snapshot={state} />);
    const ordered = [
      screen.getByText('First user prose.'),
      screen.getByText('Second user prose.'),
      screen.getByRole('button', { name: 'Preview a.txt' }),
      screen.getByRole('button', { name: 'Preview b.txt' }),
    ].map((node) => Array.from(container.querySelectorAll('*')).indexOf(node));
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(screen.getAllByTestId('acp-attachment-icon')).toHaveLength(2);
  });

  it('dismisses the session error banner', () => {
    const onDismissError = vi.fn();
    render(<AcpTimeline snapshot={snapshot({})} error="Connection lost" onDismissError={onDismissError} />);

    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Connection lost');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
