import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ArtifactPanel } from '@/components/file-preview/ArtifactPanel';
import { ARTIFACT_PANEL_DEFAULT_WIDTH, useArtifactPanel } from '@/stores/artifact-panel';
import type { AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';

const shellShowItemInFolder = vi.fn(async () => undefined);

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    shell: { showItemInFolder: (...args: unknown[]) => shellShowItemInFolder(...args) },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const labels: Record<string, string> = {
        'artifactPanel.tabs.browser': 'Workspace',
        'artifactPanel.tabs.preview': 'Preview',
        'artifactPanel.tabs.changes': 'Changes',
        'artifactPanel.changes.heading': `File changes (${String(options?.count ?? '')})`,
        'artifactPanel.changes.empty': 'This session has no file changes yet.',
        'artifactPanel.changes.diffUnavailable': 'Diff unavailable',
        'artifactPanel.changes.changeRecord': `Change ${String(options?.number ?? '')}`,
        'filePreview.actions.close': 'Close',
      };
      return labels[key] ?? '';
    },
  }),
}));

vi.mock('@/components/file-preview/FilePreviewBody', () => ({
  FilePreviewBody: ({ file, mode }: { file: { fileName: string }; mode: string }) => (
    <div data-testid="file-preview-body">{mode}:{file.fileName}</div>
  ),
}));

vi.mock('@/components/file-preview/MonacoDiffViewer', () => ({
  default: ({ filePath, original, modified }: { filePath: string; original: string; modified: string }) => (
    <div data-testid="monaco-diff-viewer">{filePath}:{original}:{modified}</div>
  ),
}));

const { workspaceBrowserProps } = vi.hoisted(() => ({
  workspaceBrowserProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/file-preview/WorkspaceBrowserBody', () => ({
  WorkspaceBrowserBody: (props: Record<string, unknown>) => {
    workspaceBrowserProps.push(props);
    return <div data-testid="workspace-browser" />;
  },
}));

function groups(): AcpSessionFileGroup[] {
  return [
    {
      relativePath: 'src/first.ts',
      activities: [
        {
          turnId: 'turn-1', toolCallId: 'edit-1', toolName: 'edit', relativePath: 'src/first.ts', action: 'modified', sequence: 0,
          fragments: [
            { oldText: 'one', newText: 'two', sequence: 0 },
            { oldText: 'three', newText: 'four', sequence: 1 },
          ],
        },
        {
          turnId: 'turn-2', toolCallId: 'edit-2', toolName: 'edit', relativePath: 'src/first.ts', action: 'modified', sequence: 2,
          fragments: [],
        },
      ],
    },
    {
      relativePath: 'src/second.ts',
      activities: [{
        turnId: 'turn-3', toolCallId: 'delete-1', toolName: 'apply_patch', relativePath: 'src/second.ts', action: 'deleted', sequence: 3, fragments: [],
      }],
    },
  ];
}

afterEach(() => {
  vi.clearAllMocks();
  act(() => {
    useArtifactPanel.setState({
      open: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });
  });
});

describe('ArtifactPanel', () => {
  it('passes effective workspace path to the workspace browser', () => {
    workspaceBrowserProps.length = 0;
    useArtifactPanel.setState({ open: true, tab: 'browser' });
    render(
      <ArtifactPanel
        fileGroups={[]}
        uniqueFileCount={0}
        agent={{ id: 'main', name: 'Main Agent', workspace: '/agent/workspace' }}
        workspacePath="/session/workspace"
        workspaceLabel="~/session/workspace"
      />,
    );
    expect(workspaceBrowserProps.at(-1)).toMatchObject({ workspacePath: '/session/workspace', workspaceLabel: '~/session/workspace' });
  });

  it('always keeps Changes available for rich preview files', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: { filePath: 'report.pdf', fileName: 'report.pdf', ext: '.pdf', mimeType: 'application/pdf', contentType: 'document' },
    });
    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    expect(screen.getByTestId('artifact-panel-tab-changes')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('artifact-panel-tab-changes'));
    expect(screen.getByText('File changes (2)')).toBeInTheDocument();
  });

  it('keeps Changes but removes the rich open-folder action for scoped files', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: 'reports/report.pdf',
        fileName: 'report.pdf',
        ext: '.pdf',
        mimeType: 'application/pdf',
        contentType: 'document',
        workspaceFileRef: { workspaceRoot: '/workspace', relativePath: 'reports/report.pdf' },
      },
    });
    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    expect(screen.getByTestId('artifact-panel-tab-changes')).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-panel-action-open-folder')).not.toBeInTheDocument();
    expect(shellShowItemInFolder).not.toHaveBeenCalled();
  });

  it('renders attachment previews without trusted rich-file folder actions', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: 'report.pdf',
        fileName: 'report.pdf',
        ext: '.pdf',
        mimeType: 'application/pdf',
        contentType: 'document',
        attachmentFileRef: {
          sessionKey: 'agent:main:s1',
          generation: 2,
          uri: 'file:///secret/report.pdf',
        },
      },
    });

    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    expect(screen.getByTestId('file-preview-body')).toHaveTextContent('preview:report.pdf');
    expect(screen.queryByTestId('artifact-panel-action-open-folder')).not.toBeInTheDocument();
    expect(shellShowItemInFolder).not.toHaveBeenCalled();
  });

  it('retains the rich open-folder action for trusted files', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: { filePath: '/tmp/report.pdf', fileName: 'report.pdf', ext: '.pdf', mimeType: 'application/pdf', contentType: 'document' },
    });
    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    fireEvent.click(screen.getByTestId('artifact-panel-action-open-folder'));
    expect(shellShowItemInFolder).toHaveBeenCalledWith('/tmp/report.pdf');
  });

  it('renders the exact empty state and ignores unrelated preview focus', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'changes',
      focusedFile: { filePath: 'notes.md', fileName: 'notes.md', ext: '.md', mimeType: 'text/markdown', contentType: 'document' },
    });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);
    expect(screen.getByText('This session has no file changes yet.')).toBeInTheDocument();
    expect(screen.getByText('This session has no file changes yet.').closest('.hidden')).toBeNull();
    expect(screen.getByTestId('file-preview-body').closest('.hidden')).not.toBeNull();
  });

  it('renders one diff per turn and file and keeps unavailable records independently', () => {
    useArtifactPanel.setState({ open: true, tab: 'changes' });
    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    expect(screen.getAllByTestId('acp-change-file-group').map((node) => node.getAttribute('data-path'))).toEqual([
      'src/first.ts',
      'src/second.ts',
    ]);
    expect(screen.getAllByTestId('monaco-diff-viewer').map((node) => node.textContent)).toEqual([
      'src/first.ts:one\n\nthree:two\n\nfour',
    ]);
    expect(screen.getAllByText('Diff unavailable')).toHaveLength(2);
  });

  it('expands file groups that arrive after an initially empty projection', () => {
    useArtifactPanel.setState({ open: true, tab: 'changes' });
    const { rerender } = render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    rerender(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    expect(screen.getAllByTestId('monaco-diff-viewer')).toHaveLength(1);
  });

  it('expands and scrolls to the focused turn, then lets the user collapse it', () => {
    const scrollIntoView = vi.fn();
    const focus = { relativePath: 'src/first.ts', turnId: 'turn-2' };
    Element.prototype.scrollIntoView = scrollIntoView;
    useArtifactPanel.getState().openChanges(focus);
    render(<ArtifactPanel fileGroups={groups()} uniqueFileCount={2} agent={null} />);

    const header = screen.getByTestId('acp-change-file-src/first.ts');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('acp-change-activity-2')).toBeInTheDocument();

    fireEvent.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('acp-change-activity-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('acp-change-file-src/second.ts'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => {
      useArtifactPanel.getState().openChanges(focus);
    });

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('acp-change-activity-2')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
