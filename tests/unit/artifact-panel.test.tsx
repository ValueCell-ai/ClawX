import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArtifactPanel } from '@/components/file-preview/ArtifactPanel';
import { ARTIFACT_PANEL_DEFAULT_WIDTH, useArtifactPanel } from '@/stores/artifact-panel';
import type { GeneratedFile } from '@/lib/generated-files';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? '',
  }),
}));

vi.mock('@/components/file-preview/FilePreviewBody', () => ({
  FilePreviewBody: ({ file, mode }: { file: { fileName: string; filePath: string }; mode: string }) => (
    <div data-testid="file-preview-body">
      <span>{mode}</span>
      <span>{file.fileName}</span>
      <span>{file.filePath}</span>
    </div>
  ),
}));

vi.mock('@/components/file-preview/WorkspaceBrowserBody', () => ({
  WorkspaceBrowserBody: () => <div data-testid="workspace-browser" />,
}));

function makeGeneratedFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    filePath: '/tmp/test_example.py',
    fileName: 'test_example.py',
    ext: '.py',
    mimeType: 'text/x-python',
    contentType: 'code',
    action: 'modified',
    fullContent: 'print("hello")\n',
    lastSeenIndex: 1,
    ...overrides,
  };
}

afterEach(() => {
  useArtifactPanel.setState({
    open: false,
    tab: 'changes',
    focusedFile: null,
    widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
  });
});

describe('ArtifactPanel', () => {
  it('keeps chat-opened SKILL.md focused when switching to changes', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'changes',
      focusedFile: {
        filePath: '~/.openclaw/skills/open-baidu/SKILL.md',
        fileName: 'SKILL.md',
        ext: '.md',
        mimeType: 'text/markdown',
        contentType: 'document',
      },
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });

    render(
      <ArtifactPanel
        files={[makeGeneratedFile()]}
        agent={null}
      />,
    );

    const previewBodies = screen.getAllByTestId('file-preview-body');
    expect(previewBodies[0]).toHaveTextContent('SKILL.md');
    expect(previewBodies[0]).toHaveTextContent('~/.openclaw/skills/open-baidu/SKILL.md');
    expect(screen.queryByText('test_example.py')).not.toBeInTheDocument();
  });

  it('keeps the selected preview file after visiting the workspace tab', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: '~/.openclaw/skills/open-xueqiu/SKILL.md',
        fileName: 'SKILL.md',
        ext: '.md',
        mimeType: 'text/markdown',
        contentType: 'document',
      },
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });

    render(
      <ArtifactPanel
        files={[makeGeneratedFile()]}
        agent={null}
      />,
    );

    expect(screen.getAllByTestId('file-preview-body')[1]).toHaveTextContent('SKILL.md');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(screen.getByTestId('workspace-browser')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getAllByTestId('file-preview-body')[1]).toHaveTextContent('SKILL.md');
    expect(screen.queryByText('No file selected')).not.toBeInTheDocument();
  });

  it('keeps panel tab buttons above iframe previews so changes stays clickable', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'preview',
      focusedFile: {
        filePath: '/tmp/demo.html',
        fileName: 'demo.html',
        ext: '.html',
        mimeType: 'text/html',
        contentType: 'document',
      },
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });

    render(
      <ArtifactPanel
        files={[makeGeneratedFile({
          filePath: '/tmp/demo.html',
          fileName: 'demo.html',
          ext: '.html',
          mimeType: 'text/html',
          contentType: 'document',
        })]}
        agent={null}
      />,
    );

    const changesButton = screen.getByTestId('artifact-panel-tab-changes');
    expect(changesButton.className).toContain('z-40');
    expect(changesButton.parentElement?.parentElement?.className).toContain('z-30');

    fireEvent.pointerDown(changesButton, { button: 0 });
    expect(screen.getAllByTestId('file-preview-body')[0]).toHaveTextContent('diff');
  });
});
