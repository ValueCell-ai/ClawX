import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkspaceBrowserBody } from '@/components/file-preview/WorkspaceBrowserBody';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useWorkspaceBrowser } from '@/stores/workspace-browser';
import type { WorkspaceTreeNode } from '@/lib/workspace-tree';

const { loadWorkspaceTree, previewProps } = vi.hoisted(() => ({
  loadWorkspaceTree: vi.fn(),
  previewProps: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/workspace-tree', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/workspace-tree')>(), loadWorkspaceTree,
}));
vi.mock('@/components/file-preview/FilePreviewSurface', () => ({
  FilePreviewSurface: (props: Record<string, unknown>) => {
    previewProps.push(props);
    return <div data-testid="shared-preview">{(props.file as { fileName?: string } | null)?.fileName ?? 'No selection'}</div>;
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const file = (relPath: string): WorkspaceTreeNode => ({ name: relPath.split('/').at(-1)!, relPath, absPath: `/workspace/${relPath}`, isDir: false, size: 12 });
const root: WorkspaceTreeNode = {
  name: 'workspace', relPath: '', absPath: '/workspace', isDir: true,
  children: [
    { name: 'docs', relPath: 'docs', absPath: '/workspace/docs', isDir: true, children: [file('docs/summary.md'), file('docs/.private.md')] },
    { name: 'src', relPath: 'src', absPath: '/workspace/src', isDir: true, children: [file('src/app.ts')] },
    file('.env'), file('readme.txt'), file('page.html'), file('slides.pptx'),
  ],
};
const agent = { id: 'main', name: 'Main Agent', workspace: '/workspace' };

beforeEach(() => {
  vi.clearAllMocks();
  previewProps.length = 0;
  loadWorkspaceTree.mockResolvedValue({ root, truncated: false });
  useWorkspaceBrowser.setState({ scopes: {} });
  useArtifactPanel.setState({ focusedFile: null, open: true, tab: 'browser' });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
});

async function ready() { await waitFor(() => expect(screen.getByRole('tree')).toBeVisible()); }

describe('WorkspaceBrowserBody', () => {
  it('loads the effective workspace while showing a title and secondary agent name', async () => {
    render(<WorkspaceBrowserBody agent={agent} workspacePath="/session/workspace" workspaceLabel="Task folder" />);
    await ready();
    expect(loadWorkspaceTree).toHaveBeenCalledWith('/session/workspace', expect.objectContaining({ includeHidden: true }));
    expect(screen.getByTestId('workspace-header-title')).toHaveTextContent('Task folder');
    expect(screen.getByTestId('workspace-agent-tag')).toHaveTextContent('Main Agent');
    expect(screen.getByTestId('workspace-path-tag')).toHaveAttribute('title', '/workspace');
  });

  it('starts collapsed, hides hidden files and searches descendants with parent context', async () => {
    render(<WorkspaceBrowserBody agent={agent} />); await ready();
    expect(screen.queryByTitle('docs/summary.md')).not.toBeInTheDocument();
    expect(screen.queryByTitle('.env')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-file-search'), { target: { value: 'summary' } });
    expect(await screen.findByTitle('docs/summary.md')).toBeVisible();
    expect(screen.getByRole('button', { name: 'docs', exact: true })).toBeVisible();
    expect(screen.queryByTitle('readme.txt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-file-search'), { target: { value: '.private' } });
    expect(screen.queryByTitle('docs/.private.md')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-show-hidden'));
    expect(await screen.findByTitle('docs/.private.md')).toBeVisible();
  });

  it('preserves folder expansion across refresh and remount, and scopes it to the agent', async () => {
    const view = render(<WorkspaceBrowserBody agent={agent} />); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'docs', exact: true }));
    expect(await screen.findByTitle('docs/summary.md')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.actions.refresh' }));
    await waitFor(() => expect(loadWorkspaceTree).toHaveBeenCalledTimes(2));
    expect(screen.getByTitle('docs/summary.md')).toBeVisible();
    view.unmount();
    const second = render(<WorkspaceBrowserBody agent={agent} />); await ready();
    expect(screen.getByTitle('docs/summary.md')).toBeVisible();
    second.rerender(<WorkspaceBrowserBody agent={{ ...agent, id: 'coder' }} />);
    await waitFor(() => expect(screen.queryByTitle('docs/summary.md')).not.toBeInTheDocument());
  });

  it.each(['readme.txt', 'page.html', 'slides.pptx'])('shares the scoped selection for %s without changing tabs', async name => {
    render(<WorkspaceBrowserBody agent={agent} />); await ready();
    fireEvent.click(screen.getByTitle(name));
    expect(useArtifactPanel.getState()).toMatchObject({ tab: 'browser', focusedFile: { fileName: name, workspaceFileRef: { workspaceRoot: '/workspace', relativePath: name } } });
    expect(screen.getByTestId('shared-preview')).toHaveTextContent(name);
    expect(screen.getByTitle(name)).toHaveClass('bg-primary/10');
  });

  it('uses the Main-resolved root for home-relative workspaces and HTML file references', async () => {
    render(<WorkspaceBrowserBody agent={{ ...agent, workspace: '~/workspace' }} />); await ready();
    fireEvent.click(screen.getByTitle('page.html'));
    expect(useArtifactPanel.getState().focusedFile?.workspaceFileRef).toEqual({ workspaceRoot: '/workspace', relativePath: 'page.html' });
    expect(screen.getByTitle('page.html')).toHaveClass('bg-primary/10');
  });

  it('keeps scoped recent files without creating history in another workspace', async () => {
    const view = render(<WorkspaceBrowserBody agent={agent} />); await ready();
    fireEvent.click(screen.getByTitle('readme.txt'));
    fireEvent.mouseDown(screen.getByTestId('workspace-view-recent'), { button: 0 });
    expect(await screen.findByTestId('workspace-quick-file-readme.txt')).toBeVisible();
    view.rerender(<WorkspaceBrowserBody agent={{ ...agent, workspace: '/other' }} />);
    await ready();
    fireEvent.mouseDown(screen.getByTestId('workspace-view-recent'), { button: 0 });
    expect(screen.queryByTestId('workspace-quick-file-readme.txt')).not.toBeInTheDocument();
  });

  it('uses session activity for task files, omits deleted files and handles empty search', async () => {
    render(<WorkspaceBrowserBody agent={agent} fileGroups={[
      { relativePath: 'docs/summary.md', activities: [{ relativePath: 'docs/summary.md', action: 'created', sequence: 1, turnId: 'one', toolCallId: 'write', toolName: 'write', fragments: [] }] },
      { relativePath: 'gone.txt', activities: [{ relativePath: 'gone.txt', action: 'deleted', sequence: 2, turnId: 'two', toolCallId: 'patch', toolName: 'apply_patch', fragments: [] }] },
    ]} />); await ready();
    fireEvent.mouseDown(screen.getByTestId('workspace-view-task'), { button: 0 });
    expect(await screen.findByTestId('workspace-quick-file-docs/summary.md')).toBeVisible();
    expect(screen.queryByTestId('workspace-quick-file-gone.txt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-file-search'), { target: { value: 'missing' } });
    expect(screen.getByText('workspace.noResults')).toBeVisible();
  });

  it('supports keyboard resizing and collapse-all without mutating files', async () => {
    render(<WorkspaceBrowserBody agent={agent} />); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'docs', exact: true }));
    fireEvent.keyDown(screen.getByTestId('workspace-tree-divider'), { key: 'ArrowRight' });
    expect(screen.getByTestId('workspace-tree-divider')).toHaveAttribute('aria-valuenow', '236');
    fireEvent.click(screen.getByTestId('workspace-collapse-all'));
    expect(screen.queryByTitle('docs/summary.md')).not.toBeInTheDocument();
  });

  it('keeps one preview surface mounted when only the preview tab changes', async () => {
    const view = render(<WorkspaceBrowserBody agent={agent} />); await ready();
    fireEvent.click(screen.getByTitle('slides.pptx'));
    view.rerender(<WorkspaceBrowserBody agent={agent} previewOnly />);
    expect(screen.getAllByTestId('shared-preview')).toHaveLength(1);
    expect(previewProps.at(-1)).toMatchObject({ active: true, file: { fileName: 'slides.pptx' } });
    view.rerender(<WorkspaceBrowserBody agent={agent} previewOnly active={false} />);
    expect(previewProps.at(-1)).toMatchObject({ active: false });
  });

  it('ignores a stale tree response after changing workspace', async () => {
    let resolve!: (value: unknown) => void;
    loadWorkspaceTree.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<WorkspaceBrowserBody agent={agent} />);
    view.rerender(<WorkspaceBrowserBody agent={{ ...agent, workspace: '/other' }} />); await ready();
    await act(async () => resolve({ root: { ...root, children: [file('stale.txt')] }, truncated: false }));
    expect(within(screen.getByTestId('workspace-tree')).queryByTitle('stale.txt')).not.toBeInTheDocument();
  });
});
