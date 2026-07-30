import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ArtifactPanel } from '@/components/file-preview/ArtifactPanel';
import { ARTIFACT_PANEL_DEFAULT_WIDTH, useArtifactPanel } from '@/stores/artifact-panel';
import type { AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';
import { MAC_TRAFFIC_LIGHT_SAFE_INSET } from '@shared/sidebar-layout';

const shellShowItemInFolder = vi.fn(async () => undefined);
const openHtmlExternal = vi.fn(async () => undefined);

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    shell: { showItemInFolder: (...args: unknown[]) => shellShowItemInFolder(...args) },
    webBrowser: { openExternal: (...args: unknown[]) => openHtmlExternal(...args) },
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
        'artifactPanel.preview.fullscreenLabel': 'Fullscreen file preview',
        'filePreview.actions.close': 'Close',
        'filePreview.actions.enterFullscreen': 'Enter fullscreen',
        'filePreview.actions.exitFullscreen': 'Exit fullscreen',
        'filePreview.actions.openHtmlExternally': 'Open HTML in system browser',
      };
      return labels[key] ?? '';
    },
  }),
}));

const { filePreviewBodyProps, workspaceBrowserProps } = vi.hoisted(() => ({
  filePreviewBodyProps: [] as Array<Record<string, unknown>>,
  workspaceBrowserProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/file-preview/FilePreviewBody', () => ({
  FilePreviewBody: (props: Record<string, unknown>) => {
    filePreviewBodyProps.push(props);
    const file = props.file as { fileName: string; ext: string };
    return (
      <div data-testid="file-preview-body">
        {String(props.mode)}:{file.fileName}
        {props.active === true && file.ext === '.pptx' && <div data-testid="pptx-viewer">preview</div>}
        {props.trailingHeader as React.ReactNode}
      </div>
    );
  },
}));

vi.mock('@/components/file-preview/MonacoDiffViewer', () => ({
  default: ({ filePath, original, modified }: { filePath: string; original: string; modified: string }) => (
    <div data-testid="monaco-diff-viewer">{filePath}:{original}:{modified}</div>
  ),
}));

vi.mock('@/components/file-preview/WorkspaceBrowserBody', () => ({
  WorkspaceBrowserBody: (props: Record<string, unknown>) => {
    workspaceBrowserProps.push(props);
    return (
      <div data-testid="workspace-browser">
        {props.active === true && <div data-testid="pptx-viewer">workspace</div>}
      </div>
    );
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
  filePreviewBodyProps.length = 0;
  workspaceBrowserProps.length = 0;
  act(() => {
    useArtifactPanel.setState({
      open: false,
      tab: 'changes',
      focusedFile: null,
      focusedChange: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
      htmlPreviewAnchor: null,
    });
  });
});

describe('ArtifactPanel', () => {
  it('renders only Workspace, Preview, and Changes tabs', () => {
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    const tabs = screen.getByTestId('artifact-panel-tabs');
    expect(Array.from(tabs.children).map((tab) => tab.getAttribute('data-testid'))).toEqual([
      'artifact-panel-tab-browser',
      'artifact-panel-tab-preview',
      'artifact-panel-tab-changes',
    ]);
  });

  it('does not render a general Web Browser tab', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: 'budget.xlsx',
        fileName: 'budget.xlsx',
        ext: '.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentType: 'document',
      },
    });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    expect(screen.queryByTestId('artifact-panel-tab-web-browser')).not.toBeInTheDocument();
  });

  it('keeps the rich-preview folder action after all three tabs', () => {
    useArtifactPanel.setState({
      focusedFile: { filePath: '/tmp/report.pdf', fileName: 'report.pdf', ext: '.pdf', mimeType: 'application/pdf', contentType: 'document' },
    });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    expect(Array.from(screen.getByTestId('artifact-panel-tabs').children).map((control) => control.getAttribute('data-testid'))).toEqual([
      'artifact-panel-tab-browser',
      'artifact-panel-tab-preview',
      'artifact-panel-tab-changes',
      'artifact-panel-action-open-folder',
    ]);
  });

  it('keeps every localized tab reachable in a horizontally scrollable row', () => {
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    const tabs = screen.getByTestId('artifact-panel-tabs');
    expect(tabs).toHaveClass('overflow-x-auto');
    expect(Array.from(tabs.children).slice(0, 3)).toHaveLength(3);
    for (const tab of Array.from(tabs.children).slice(0, 3)) {
      expect(tab).toHaveClass('shrink-0');
    }
  });

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

  it('keeps both preview surfaces mounted but activates only the visible PPTX surface', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: '/tmp/slides.pptx', fileName: 'slides.pptx', ext: '.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', contentType: 'document',
      },
    });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    expect(workspaceBrowserProps.at(-1)).toMatchObject({ active: false });
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ active: true });
    expect(screen.getAllByTestId('pptx-viewer')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('artifact-panel-tab-browser'));

    expect(screen.getByTestId('workspace-browser')).toBeInTheDocument();
    expect(screen.getByTestId('file-preview-body')).toBeInTheDocument();
    expect(workspaceBrowserProps.at(-1)).toMatchObject({ active: true });
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ active: false });
    expect(screen.getAllByTestId('pptx-viewer')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('artifact-panel-tab-changes'));

    expect(workspaceBrowserProps.at(-1)).toMatchObject({ active: false });
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ active: false });
    expect(screen.queryByTestId('pptx-viewer')).not.toBeInTheDocument();
  });

  it('opens the selected file in a fullscreen layer and exits with Escape', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: '/tmp/report.pdf', fileName: 'report.pdf', ext: '.pdf',
        mimeType: 'application/pdf', contentType: 'document',
      },
    });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    expect(filePreviewBodyProps.at(-1)).toMatchObject({
      compact: true,
      headerLeftInset: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));

    expect(screen.getByRole('dialog', { name: 'Fullscreen file preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toHaveFocus();
    expect(filePreviewBodyProps.at(-1)).toMatchObject({
      compact: false,
      headerLeftInset: MAC_TRAFFIC_LIGHT_SAFE_INSET,
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('file-preview-fullscreen-layer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument();
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ compact: true });

    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    act(() => useArtifactPanel.getState().setTab('changes'));
    expect(screen.queryByTestId('file-preview-fullscreen-layer')).not.toBeInTheDocument();
  });

  it('does not reserve traffic-light space for fullscreen previews off macOS', () => {
    const originalPlatform = window.electron.platform;
    window.electron.platform = 'linux';
    try {
      useArtifactPanel.setState({
        open: true,
        tab: 'preview',
        focusedFile: {
          filePath: '/tmp/report.pdf', fileName: 'report.pdf', ext: '.pdf',
          mimeType: 'application/pdf', contentType: 'document',
        },
      });
      render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

      fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));

      expect(filePreviewBodyProps.at(-1)).toMatchObject({
        compact: false,
        headerLeftInset: undefined,
      });
    } finally {
      window.electron.platform = originalPlatform;
    }
  });

  it('preserves the viewer-reported PowerPoint position for each preview target', () => {
    const first = {
      filePath: '/tmp/first.pptx', fileName: 'first.pptx', ext: '.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', contentType: 'document' as const,
    };
    const second = { ...first, filePath: '/tmp/second.pptx', fileName: 'second.pptx' };
    useArtifactPanel.setState({ open: true, tab: 'preview', focusedFile: first });
    render(<ArtifactPanel fileGroups={[]} uniqueFileCount={0} agent={null} />);

    expect(filePreviewBodyProps.at(-1)).toMatchObject({ initialPptxSlideIndex: 0 });
    (filePreviewBodyProps.at(-1)?.onPptxSlideIndexChange as ((index: number) => void) | undefined)?.(2);

    act(() => useArtifactPanel.setState({ focusedFile: second }));
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ initialPptxSlideIndex: 0 });

    act(() => useArtifactPanel.setState({ focusedFile: first }));
    expect(filePreviewBodyProps.at(-1)).toMatchObject({ initialPptxSlideIndex: 2 });
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
