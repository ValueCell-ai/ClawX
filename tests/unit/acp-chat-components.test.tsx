import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpToolCallCard } from '@/pages/Chat/AcpToolCallCard';
import { AcpAttachmentPart } from '@/pages/Chat/AcpAttachmentPart';
import { AcpTimeline } from '@/pages/Chat/AcpTimeline';
import { AcpTurnFileActivity } from '@/pages/Chat/AcpTurnFileActivity';
import type { AcpTimelineSnapshot, AttachmentRenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import type { AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { useArtifactPanel } from '@/stores/artifact-panel';

const openAttachmentMock = vi.hoisted(() => vi.fn());
const listAttachmentOpenHandlersMock = vi.hoisted(() => vi.fn());
const openAttachmentWithMock = vi.hoisted(() => vi.fn());
const revealAttachmentMock = vi.hoisted(() => vi.fn());
const listWorkspaceOpenHandlersMock = vi.hoisted(() => vi.fn());
const openWorkspaceWithMock = vi.hoisted(() => vi.fn());
const revealWorkspaceFileMock = vi.hoisted(() => vi.fn());
const thumbnailsMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const i18nLanguage = vi.hoisted(() => ({ value: 'en' }));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: {
      openAttachment: openAttachmentMock,
      listAttachmentOpenHandlers: listAttachmentOpenHandlersMock,
      openAttachmentWith: openAttachmentWithMock,
      revealAttachment: revealAttachmentMock,
      listWorkspaceOpenHandlers: listWorkspaceOpenHandlersMock,
      openWorkspaceWith: openWorkspaceWithMock,
      revealWorkspaceFile: revealWorkspaceFileMock,
    },
    media: {
      thumbnails: thumbnailsMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (i18nLanguage.value === 'zh' && key === 'acp.turnDuration') return `用时 ${String(options?.duration ?? '')}`;
      if (i18nLanguage.value === 'zh' && key === 'acp.turnElapsed') return `已处理 ${String(options?.duration ?? '')}`;
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
        'acp.turnDuration': 'Took {{duration}}',
        'acp.turnElapsed': '{{duration}} elapsed',
        'acp.dismiss': 'Dismiss',
        'acp.attachment.loading': 'Loading attachment',
        'acp.attachment.unavailable': 'Attachment unavailable',
        'acp.attachment.open': 'Open {{name}}',
        'acp.attachment.preview': 'Preview {{name}}',
        'acp.attachment.openFailed': 'Could not open attachment',
        'fileCard.openWith': 'Open with',
        'fileCard.openWithFile': 'Open {{name}} with',
        'fileCard.openInBuiltInBrowser': 'Open in built-in browser',
        'fileCard.searchingApplications': 'Searching for applications',
        'fileCard.showInFinder': 'Show in Finder',
        'fileCard.showInExplorer': 'Show in File Explorer',
        'fileCard.showInFileManager': 'Show in file manager',
        'fileCard.openWithFailed': 'Could not open file with the selected application',
        'fileCard.revealFailed': 'Could not show file in its folder',
        'fileActivity.created': 'Created',
        'fileActivity.modified': 'Modified',
        'fileActivity.deleted': 'Deleted',
        'fileActivity.fileButton': '{{action}} {{path}}',
        'fileActivity.changeRecord': 'View changes for {{path}}',
      };
      return (labels[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { get language() { return i18nLanguage.value; } },
  }),
}));

const attachmentRef = {
  sessionKey: 'agent:main:s1',
  generation: 1,
  uri: 'file:///workspace/report.pdf',
};

function availableAttachment(overrides: {
  name?: string;
  mimeType?: string;
  size?: number;
  target?: Extract<AttachmentRenderPart['access'], { status: 'available' }>['target'];
  ref?: typeof attachmentRef;
} = {}): AttachmentRenderPart {
  const name = overrides.name ?? 'report.pdf';
  const ref = overrides.ref ?? { ...attachmentRef, uri: `file:///workspace/${name}` };
  return {
    kind: 'attachment',
    attachmentId: `attachment:${name}`,
    reference: { uri: ref.uri, name },
    source: 'acp-resource',
    access: {
      status: 'available',
      identity: `opaque-${name}`,
      target: overrides.target ?? { kind: 'local', scope: 'workspace', ref },
      mimeType: overrides.mimeType ?? 'application/pdf',
      size: overrides.size ?? 1024,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openAttachmentMenu(name = 'report.pdf') {
  const trigger = screen.getByRole('button', { name: `Open ${name} with` });
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await screen.findByRole('menu');
  return trigger;
}

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
    i18nLanguage.value = 'en';
    window.electron.platform = 'darwin';
    openAttachmentMock.mockResolvedValue({ ok: true });
    listAttachmentOpenHandlersMock.mockResolvedValue({ ok: true, platform: 'darwin', handlers: [] });
    openAttachmentWithMock.mockResolvedValue({ ok: true });
    revealAttachmentMock.mockResolvedValue({ ok: true });
    listWorkspaceOpenHandlersMock.mockResolvedValue({ ok: true, platform: 'darwin', handlers: [] });
    openWorkspaceWithMock.mockResolvedValue({ ok: true });
    revealWorkspaceFileMock.mockResolvedValue({ ok: true });
    thumbnailsMock.mockResolvedValue({});
    useArtifactPanel.setState({
      open: false,
      tab: 'changes',
      focusedFile: null,
      webBrowserNavigation: null,
      webBrowserNavigationId: 0,
    });
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

  it('shows a fixed whole-turn duration on the ACP-replayed assistant turn', () => {
    const state = snapshot({
      itemOrder: ['user-a:0', 'assistant-a:0'],
      itemsById: {
        'user-a:0': {
          kind: 'message-segment', id: 'user-a:0', role: 'user', messageId: 'user-a', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Measure this' }],
        },
        'assistant-a:0': {
          kind: 'message-segment', id: 'assistant-a:0', role: 'assistant', messageId: 'assistant-a', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Measured' }],
        },
      },
    });

    render(<AcpTimeline
      snapshot={state}
      turnTimingsByUserMessageId={{
        'user-a': { source: 'transcript', status: 'complete', durationMs: 6_400 },
      }}
    />);

    expect(screen.getByTestId('acp-turn-duration')).toHaveTextContent('Took 6 sec');
  });

  it('floors Chinese whole-turn seconds, spaces the unit, and uses processing/completed copy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    i18nLanguage.value = 'zh';
    const state = snapshot({
      itemOrder: ['user-a:0', 'assistant-a:0', 'user-b:0', 'assistant-b:0'],
      itemsById: {
        'user-a:0': {
          kind: 'message-segment', id: 'user-a:0', role: 'user', messageId: 'user-a', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Completed' }],
        },
        'assistant-a:0': {
          kind: 'message-segment', id: 'assistant-a:0', role: 'assistant', messageId: 'assistant-a', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Done' }],
        },
        'user-b:0': {
          kind: 'message-segment', id: 'user-b:0', role: 'user', messageId: 'user-b', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Running' }],
        },
        'assistant-b:0': {
          kind: 'message-segment', id: 'assistant-b:0', role: 'assistant', messageId: 'assistant-b', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Working' }],
        },
      },
    });

    render(<AcpTimeline
      snapshot={state}
      turnTimingsByUserMessageId={{
        'user-a': { source: 'transcript', status: 'complete', durationMs: 23_600 },
        'user-b': { source: 'live', status: 'running', startedAtMs: 600 },
      }}
    />);

    expect(screen.getByText('用时 23 秒')).toBeVisible();
    expect(screen.getByText('已处理 19 秒')).toBeVisible();
    vi.useRealTimers();
  });

  it('updates a running whole-turn elapsed duration from its original start time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const state = snapshot({
      itemOrder: ['user-a:0', 'tool:read-file'],
      itemsById: {
        'user-a:0': {
          kind: 'message-segment', id: 'user-a:0', role: 'user', messageId: 'user-a', segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'Read it' }],
        },
        'tool:read-file': toolCallItem({ status: 'running' }),
      },
    });

    render(<AcpTimeline
      snapshot={state}
      turnTimingsByUserMessageId={{
        'user-a': { source: 'live', status: 'running', startedAtMs: 7_000 },
      }}
    />);
    expect(screen.getByTestId('acp-turn-duration')).toHaveTextContent('3 sec elapsed');

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('acp-turn-duration')).toHaveTextContent('4 sec elapsed');
    vi.useRealTimers();
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
    expect(screen.queryByRole('button', { name: 'Open old.md with' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('acp-file-button'));
    expect(useArtifactPanel.getState().focusedChange).toMatchObject({
      relativePath: 'old.md',
      turnId,
      navigationId: expect.any(Number),
    });
    expect(listWorkspaceOpenHandlersMock).not.toHaveBeenCalled();
    expect(openWorkspaceWithMock).not.toHaveBeenCalled();
    expect(revealWorkspaceFileMock).not.toHaveBeenCalled();
  });

  it.each(['created', 'modified'] as const)(
    'shows workspace Open with for %s activity and routes every menu action with a WorkspaceFileRef',
    async (action) => {
      const ref = { workspaceRoot: '/workspace', relativePath: 'report.md' };
      listWorkspaceOpenHandlersMock.mockResolvedValue({
        ok: true,
        platform: 'darwin',
        handlers: [{ handlerId: 'opaque-reader-id', name: 'Reader', isDefault: true }],
      });
      render(
        <AcpTurnFileActivity
          workspaceRoot={ref.workspaceRoot}
          summaries={[{
            turnId: `turn-${action}`,
            relativePath: ref.relativePath,
            action,
            activities: [],
            added: 1,
            removed: action === 'modified' ? 1 : 0,
          }]}
        />,
      );

      await openAttachmentMenu(ref.relativePath);
      expect(listWorkspaceOpenHandlersMock).toHaveBeenCalledWith(ref);
      expect(listAttachmentOpenHandlersMock).not.toHaveBeenCalled();

      fireEvent.click(await screen.findByRole('menuitem', { name: 'Reader' }));
      await waitFor(() => expect(openWorkspaceWithMock).toHaveBeenCalledWith({
        ref,
        handlerId: 'opaque-reader-id',
      }));
      expect(openAttachmentWithMock).not.toHaveBeenCalled();

      await openAttachmentMenu(ref.relativePath);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show in Finder' }));
      await waitFor(() => expect(revealWorkspaceFileMock).toHaveBeenCalledWith(ref));
      expect(revealAttachmentMock).not.toHaveBeenCalled();
    },
  );

  it('opens HTML file activity in the built-in browser from the first Open with item', async () => {
    render(
      <AcpTurnFileActivity
        workspaceRoot="/workspace/demo"
        summaries={[{
          turnId: 'turn-html',
          relativePath: 'site/report #1.html',
          action: 'created',
          activities: [],
          added: 1,
          removed: 0,
        }]}
      />,
    );

    await openAttachmentMenu('site/report #1.html');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Open in built-in browser');
    fireEvent.click(items[0]);

    expect(useArtifactPanel.getState()).toMatchObject({
      open: true,
      tab: 'web-browser',
      webBrowserInitialized: true,
      webBrowserNavigation: {
        url: 'file:///workspace/demo/site/report%20%231.html',
      },
    });
    expect(listWorkspaceOpenHandlersMock).toHaveBeenCalledWith({
      workspaceRoot: '/workspace/demo',
      relativePath: 'site/report #1.html',
    });
  });

  it.each(['report.docx', 'slides.pptx'])('routes active Office file activity %s through a workspace-scoped preview target', (relativePath) => {
    render(
      <AcpTurnFileActivity
        workspaceRoot="/workspace"
        summaries={[{
          turnId: 'turn-office',
          relativePath,
          action: 'created',
          activities: [],
          added: null,
          removed: null,
        }]}
      />,
    );

    fireEvent.click(screen.getByTestId('acp-file-button'));

    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      filePath: relativePath,
      contentType: 'document',
      workspaceFileRef: { workspaceRoot: '/workspace', relativePath },
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

  it('embeds the open-with control inside an eligible assistant preview card', () => {
    const part = availableAttachment();
    render(<AcpAttachmentPart part={part} />);

    const preview = screen.getByRole('button', { name: 'Preview report.pdf' });
    const trigger = screen.getByRole('button', { name: 'Open report.pdf with' });
    expect(preview.parentElement).toBe(trigger.parentElement);
    expect(preview.parentElement).toHaveClass('items-center', 'gap-1', 'p-1');
    expect(preview).toHaveClass('flex-1', 'rounded-lg');
    expect(preview).not.toHaveClass('rounded-l-xl');
    expect(trigger).toHaveClass('rounded-md');
    expect(trigger).not.toHaveClass('self-stretch', 'border-l', 'rounded-r-xl');

    fireEvent.click(preview);

    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      fileName: 'report.pdf',
      attachmentFileRef: part.access.status === 'available' && part.access.target.ref,
    });
    expect(listAttachmentOpenHandlersMock).not.toHaveBeenCalled();
    expect(openAttachmentWithMock).not.toHaveBeenCalled();
    expect(revealAttachmentMock).not.toHaveBeenCalled();
  });

  it('opens a local HTML attachment in the built-in browser from the first Open with item', async () => {
    render(<AcpAttachmentPart part={availableAttachment({
      name: 'site one.html',
      mimeType: 'text/html',
      ref: {
        ...attachmentRef,
        uri: '/workspace/site one.html',
      },
    })} />);

    await openAttachmentMenu('site one.html');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Open in built-in browser');
    fireEvent.click(items[0]);

    expect(useArtifactPanel.getState()).toMatchObject({
      open: true,
      tab: 'web-browser',
      webBrowserInitialized: true,
      webBrowserNavigation: {
        url: 'file:///workspace/site%20one.html',
      },
    });
  });

  it.each([
    ['user tone', availableAttachment(), 'user'],
    ['pending access', {
      ...availableAttachment(),
      access: { status: 'pending' as const },
    }, 'assistant'],
    ['unavailable access', {
      ...availableAttachment(),
      access: { status: 'unavailable' as const, reason: 'operationFailed' as const },
    }, 'assistant'],
    ['remote target', availableAttachment({
      target: { kind: 'remote', ref: attachmentRef, url: 'https://example.com/report.pdf' },
    }), 'assistant'],
    ['system-open-only attachment', availableAttachment({ name: 'archive.zip', mimeType: 'application/zip' }), 'assistant'],
    ['oversized preview attachment', availableAttachment({ size: 50 * 1024 * 1024 + 1 }), 'assistant'],
  ] as const)('does not add the open-with trigger for %s', (_case, part, tone) => {
    render(<AcpAttachmentPart part={part} tone={tone} />);
    expect(screen.queryByRole('button', { name: / with$/ })).not.toBeInTheDocument();
  });

  it('opens a separate keyboard-accessible menu without activating preview', async () => {
    render(<AcpAttachmentPart part={availableAttachment()} />);

    const trigger = await openAttachmentMenu();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(useArtifactPanel.getState().focusedFile).toBeNull();
    expect(listAttachmentOpenHandlersMock).toHaveBeenCalledWith(attachmentRef);
  });

  it('shows reveal while discovery loads, then sorts the default first and the rest by locale', async () => {
    const discovery = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; iconDataUrl?: string; isDefault: boolean }>;
    }>();
    listAttachmentOpenHandlersMock.mockReturnValueOnce(discovery.promise);
    render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();
    expect(screen.getByTestId('acp-attachment-open-with-loading')).toHaveTextContent('Searching for applications');
    expect(screen.getByTestId('acp-attachment-reveal')).toHaveTextContent('Show in Finder');

    const iconDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    discovery.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [
        { handlerId: 'beta', name: 'Beta', isDefault: false },
        { handlerId: 'default', name: 'Zulu', iconDataUrl, isDefault: true },
        { handlerId: 'alpha', name: 'Alpha', isDefault: false },
      ],
    });

    await waitFor(() => expect(screen.queryByTestId('acp-attachment-open-with-loading')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('acp-attachment-open-with-app').map((row) => row.textContent)).toEqual([
      'Zulu',
      'Alpha',
      'Beta',
    ]);
    expect(screen.getByTestId('acp-attachment-open-with-native-icon')).toHaveAttribute('src', iconDataUrl);
    expect(screen.getByTestId('acp-attachment-open-with-native-icon')).toHaveClass('h-5', 'w-5');
  });

  it('uses a generic application icon for missing, invalid, oversized, and failed native icons', async () => {
    const oversizedIcon = `data:image/png;base64,${'A'.repeat(65_536)}`;
    listAttachmentOpenHandlersMock.mockResolvedValueOnce({
      ok: true,
      platform: 'darwin',
      handlers: [
        { handlerId: 'missing', name: 'Missing', isDefault: true },
        { handlerId: 'invalid', name: 'Invalid', iconDataUrl: 'file:///Applications/Invalid.app', isDefault: false },
        { handlerId: 'oversized', name: 'Oversized', iconDataUrl: oversizedIcon, isDefault: false },
        { handlerId: 'broken', name: 'Broken', iconDataUrl: 'data:image/png;base64,broken', isDefault: false },
      ],
    });
    render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();
    await screen.findByText('Missing');
    expect(screen.getAllByTestId('acp-attachment-open-with-generic-icon')).toHaveLength(3);
    expect(screen.getAllByTestId('acp-attachment-open-with-generic-icon')[0]).toHaveClass('h-5', 'w-5');

    fireEvent.error(screen.getByTestId('acp-attachment-open-with-native-icon'));
    expect(screen.getAllByTestId('acp-attachment-open-with-generic-icon')).toHaveLength(4);
  });

  it('silently removes failed discovery while preserving reveal', async () => {
    listAttachmentOpenHandlersMock
      .mockRejectedValueOnce(new Error('discovery failed'))
      .mockResolvedValueOnce({ ok: false, error: 'operationFailed' });
    render(<AcpAttachmentPart part={availableAttachment()} />);

    const trigger = await openAttachmentMenu();
    await waitFor(() => expect(screen.queryByTestId('acp-attachment-open-with-loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('acp-attachment-reveal')).toBeEnabled();
    expect(screen.queryByTestId('acp-attachment-open-with-app')).not.toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
    await screen.findByRole('menu');
    await waitFor(() => expect(screen.queryByTestId('acp-attachment-open-with-loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('acp-attachment-reveal')).toBeEnabled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('opens with the exact attachment ref and handler id and toasts only explicit action failure', async () => {
    listAttachmentOpenHandlersMock.mockResolvedValue({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'com.example.Reader', name: 'Reader', isDefault: true }],
    });
    render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();
    fireEvent.click(await screen.findByText('Reader'));
    await waitFor(() => expect(openAttachmentWithMock).toHaveBeenCalledWith({
      ref: attachmentRef,
      handlerId: 'com.example.Reader',
    }));
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(useArtifactPanel.getState().focusedFile).toBeNull();

    openAttachmentWithMock.mockResolvedValueOnce({ ok: false, error: 'operationFailed' });
    await openAttachmentMenu();
    fireEvent.click(await screen.findByText('Reader'));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Could not open file with the selected application'));
  });

  it.each([
    ['darwin', 'Show in Finder'],
    ['win32', 'Show in File Explorer'],
  ] as const)('reveals through the scoped host action with the %s platform label', async (platform, label) => {
    window.electron.platform = platform;
    revealAttachmentMock.mockResolvedValueOnce({ ok: false, error: 'operationFailed' });
    render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: label }));

    await waitFor(() => expect(revealAttachmentMock).toHaveBeenCalledWith(attachmentRef));
    expect(toastErrorMock).toHaveBeenCalledWith('Could not show file in its folder');
  });

  it('renders a reveal-only Linux menu without requesting application discovery', async () => {
    window.electron.platform = 'linux';
    render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();

    expect(screen.getByRole('menuitem', { name: 'Show in file manager' })).toBeInTheDocument();
    expect(screen.queryByTestId('acp-attachment-open-with-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('acp-attachment-open-with-app')).not.toBeInTheDocument();
    expect(listAttachmentOpenHandlersMock).not.toHaveBeenCalled();
  });

  it('discovers again after reopen, ignores the closed request, and restores trigger focus on Escape', async () => {
    const first = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    const second = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    listAttachmentOpenHandlersMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<AcpAttachmentPart part={availableAttachment()} />);

    const trigger = await openAttachmentMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
    await screen.findByRole('menu');
    expect(listAttachmentOpenHandlersMock).toHaveBeenCalledTimes(2);
    first.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'stale', name: 'Stale App', isDefault: true }],
    });
    await act(async () => first.promise);
    expect(screen.queryByText('Stale App')).not.toBeInTheDocument();

    second.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'fresh', name: 'Fresh App', isDefault: true }],
    });
    expect(await screen.findByText('Fresh App')).toBeInTheDocument();
  });

  it('never renders or activates resolved handlers after the attachment ref changes', async () => {
    const refA = { ...attachmentRef, uri: 'file:///workspace/report-a.pdf' };
    const refB = { ...attachmentRef, generation: 2, uri: 'file:///workspace/report-b.pdf' };
    const discoveryB = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    listAttachmentOpenHandlersMock
      .mockResolvedValueOnce({
        ok: true,
        platform: 'darwin',
        handlers: [{ handlerId: 'app-a', name: 'App A', isDefault: true }],
      })
      .mockReturnValueOnce(discoveryB.promise);
    const { rerender } = render(<AcpAttachmentPart part={availableAttachment({ ref: refA })} />);

    await openAttachmentMenu();
    expect(await screen.findByText('App A')).toBeInTheDocument();

    rerender(<AcpAttachmentPart part={availableAttachment({ ref: refB })} />);
    const staleRow = screen.queryByRole('menuitem', { name: 'App A' });
    if (staleRow) fireEvent.click(staleRow);
    expect(openAttachmentWithMock).not.toHaveBeenCalledWith({ ref: refB, handlerId: 'app-a' });
    expect(staleRow).not.toBeInTheDocument();

    await waitFor(() => expect(listAttachmentOpenHandlersMock).toHaveBeenLastCalledWith(refB));
    discoveryB.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'app-b', name: 'App B', isDefault: true }],
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'App B' }));

    await waitFor(() => expect(openAttachmentWithMock).toHaveBeenCalledWith({ ref: refB, handlerId: 'app-b' }));
    expect(openAttachmentWithMock).toHaveBeenCalledTimes(1);
  });

  it('ignores stale discovery after the attachment ref changes or the card unmounts', async () => {
    const oldDiscovery = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    const newDiscovery = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    const unmountedDiscovery = deferred<{
      ok: true;
      platform: 'darwin';
      handlers: Array<{ handlerId: string; name: string; isDefault: boolean }>;
    }>();
    listAttachmentOpenHandlersMock
      .mockReturnValueOnce(oldDiscovery.promise)
      .mockReturnValueOnce(newDiscovery.promise)
      .mockReturnValueOnce(unmountedDiscovery.promise);
    const { rerender, unmount } = render(<AcpAttachmentPart part={availableAttachment()} />);

    await openAttachmentMenu();
    const nextRef = { ...attachmentRef, generation: 2 };
    rerender(<AcpAttachmentPart part={availableAttachment({ ref: nextRef })} />);
    oldDiscovery.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'old-ref', name: 'Old Ref App', isDefault: true }],
    });
    await act(async () => oldDiscovery.promise);
    expect(screen.queryByText('Old Ref App')).not.toBeInTheDocument();

    newDiscovery.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'new-ref', name: 'New Ref App', isDefault: true }],
    });
    expect(await screen.findByText('New Ref App')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await openAttachmentMenu();
    unmount();
    unmountedDiscovery.resolve({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId: 'unmounted', name: 'Unmounted App', isDefault: true }],
    });
    await act(async () => unmountedDiscovery.promise);
    expect(screen.queryByText('Unmounted App')).not.toBeInTheDocument();
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
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('previews an authorized in-limit Office attachment %s', (name, mimeType) => {
    const part = availableAttachment({ name, mimeType, size: 20 * 1024 * 1024 });
    render(<AcpAttachmentPart part={part} />);

    fireEvent.click(screen.getByRole('button', { name: `Preview ${name}` }));

    expect(useArtifactPanel.getState().focusedFile).toMatchObject({
      fileName: name,
      contentType: 'document',
      attachmentFileRef: part.access.status === 'available' && part.access.target.ref,
    });
    expect(openAttachmentMock).not.toHaveBeenCalled();
  });

  it.each([
    ['archive.zip', 'application/zip', 1024],
    ['large.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 20 * 1024 * 1024 + 1],
    ['large.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 20 * 1024 * 1024 + 1],
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

  it.each([
    ['remote.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['remote.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('opens remote Office attachment %s through the scoped host action', async (name, mimeType) => {
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: `https://example.com/${name}` };
    const part = availableAttachment({
      name,
      mimeType,
      target: { kind: 'remote', ref, url: ref.uri },
      ref,
    });
    render(<AcpAttachmentPart part={part} />);

    fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }));

    await waitFor(() => expect(openAttachmentMock).toHaveBeenCalledWith(ref));
    expect(useArtifactPanel.getState().focusedFile).toBeNull();
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
