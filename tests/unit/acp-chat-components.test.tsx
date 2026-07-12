import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AcpToolCallCard } from '@/pages/Chat/AcpToolCallCard';
import { AcpTimeline } from '@/pages/Chat/AcpTimeline';
import type { AcpTimelineSnapshot, ToolCallItem } from '@/lib/acp/timeline-types';
import type { AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { useArtifactPanel } from '@/stores/artifact-panel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
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
        'fileActivity.created': 'Created',
        'fileActivity.modified': 'Modified',
        'fileActivity.deleted': 'Deleted',
        'fileActivity.fileButton': '{{action}} {{path}}',
        'fileActivity.changeRecord': 'View changes for {{path}}',
      };
      return labels[key] ?? key;
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

  it('dismisses the session error banner', () => {
    const onDismissError = vi.fn();
    render(<AcpTimeline snapshot={snapshot({})} error="Connection lost" onDismissError={onDismissError} />);

    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('Connection lost');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
