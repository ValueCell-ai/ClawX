import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceBrowserBody } from '@/components/file-preview/WorkspaceBrowserBody';
import type { WorkspaceTreeNode } from '@/lib/workspace-tree';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? _key
    ),
  }),
}));

const readTextFile = vi.fn();

vi.mock('@/lib/file-preview-client', () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  statFile: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    shell: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
  },
}));

const htmlNode: WorkspaceTreeNode = {
  name: 'dashboard.html',
  relPath: 'dashboard.html',
  absPath: '/workspace/dashboard.html',
  isDir: false,
  size: 10_700,
  ext: '.html',
  mimeType: 'text/html',
  contentType: 'document',
};

vi.mock('@/lib/workspace-tree', () => ({
  loadWorkspaceTree: vi.fn(async () => ({
    root: {
      name: 'workspace',
      relPath: '',
      absPath: '/workspace',
      isDir: true,
      children: [htmlNode],
    },
    truncated: false,
  })),
  collectInitialExpanded: vi.fn(() => new Set([''])),
  findNode: vi.fn((root: WorkspaceTreeNode, relPath: string) => {
    if (relPath === 'dashboard.html') return htmlNode;
    return null;
  }),
}));

describe('WorkspaceBrowserBody', () => {
  it('renders html files as sandboxed HTML preview instead of raw source', async () => {
    readTextFile.mockResolvedValueOnce({
      ok: true,
      content: '<!doctype html><html><body><h1 id="title">Dashboard</h1></body></html>',
      size: 72,
      readOnly: true,
    });

    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('dashboard.html')).toBeVisible();
    });

    fireEvent.click(screen.getByText('dashboard.html'));

    const frame = await screen.findByTestId('html-preview-frame');
    expect(frame).toBeVisible();
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads',
    );
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
  });
});
