import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceBrowserBody } from '@/components/file-preview/WorkspaceBrowserBody';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? _key
    ),
  }),
}));

const {
  readTextFile,
  statFile,
  loadWorkspaceTree,
  collectInitialExpanded,
  findNode,
} = vi.hoisted(() => {
  const htmlNode = {
    name: 'dashboard.html',
    relPath: 'dashboard.html',
    absPath: '/workspace/dashboard.html',
    isDir: false,
    size: 10_700,
    ext: '.html',
    mimeType: 'text/html',
    contentType: 'document',
  };

  const envNode = {
    name: '.env',
    relPath: '.env',
    absPath: '/workspace/.env',
    isDir: false,
    size: 128,
    ext: '',
    mimeType: 'text/plain',
    contentType: 'text',
  };

  const configHiddenNode = {
    name: '.config.env',
    relPath: 'config/.config.env',
    absPath: '/workspace/config/.config.env',
    isDir: false,
    size: 64,
    ext: '',
    mimeType: 'text/plain',
    contentType: 'text',
  };

  const nestedHiddenNode = {
    name: '.nested.env',
    relPath: 'src/nested/.nested.env',
    absPath: '/workspace/src/nested/.nested.env',
    isDir: false,
    size: 64,
    ext: '',
    mimeType: 'text/plain',
    contentType: 'text',
  };

  const configNode = {
    name: 'config',
    relPath: 'config',
    absPath: '/workspace/config',
    isDir: true,
    children: [configHiddenNode],
  };

  const nestedNode = {
    name: 'nested',
    relPath: 'src/nested',
    absPath: '/workspace/src/nested',
    isDir: true,
    children: [nestedHiddenNode],
  };

  const srcNode = {
    name: 'src',
    relPath: 'src',
    absPath: '/workspace/src',
    isDir: true,
    children: [nestedNode],
  };

  return {
    readTextFile: vi.fn(),
    statFile: vi.fn(),
    loadWorkspaceTree: vi.fn(async () => ({
      root: {
        name: 'workspace',
        relPath: '',
        absPath: '/workspace',
        isDir: true,
        children: [htmlNode, envNode, configNode, srcNode],
      },
      truncated: false,
    })),
    collectInitialExpanded: vi.fn(() => new Set(['', 'config', 'src'])),
    findNode: vi.fn((_root: unknown, relPath: string) => {
      if (relPath === 'dashboard.html') return htmlNode;
      if (relPath === '.env') return envNode;
      if (relPath === 'config') return configNode;
      if (relPath === 'config/.config.env') return configHiddenNode;
      if (relPath === 'src') return srcNode;
      if (relPath === 'src/nested') return nestedNode;
      if (relPath === 'src/nested/.nested.env') return nestedHiddenNode;
      return null;
    }),
  };
});

vi.mock('@/lib/file-preview-client', () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  statFile,
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    shell: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
  },
}));

vi.mock('@/lib/workspace-tree', () => ({
  loadWorkspaceTree,
  collectInitialExpanded,
  findNode,
}));

describe('WorkspaceBrowserBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads hidden files by default and shows the workspace path only in the header', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/Users/alex/.openclaw/workspace-main' }}
      />,
    );

    await waitFor(() => {
      expect(loadWorkspaceTree).toHaveBeenCalledWith(
        '/Users/alex/.openclaw/workspace-main',
        expect.objectContaining({ includeHidden: true, runStartedAt: null }),
      );
    });
    expect(screen.getByTestId('workspace-path')).toHaveTextContent('~/.openclaw/workspace-main');
    expect(screen.getByTestId('workspace-path')).toHaveAttribute('title', '/Users/alex/.openclaw/workspace-main');
    expect(screen.queryByRole('button', { name: /hidden files/i })).not.toBeInTheDocument();
    expect(screen.getByText('.env')).toBeVisible();
    expect(screen.getByTestId('workspace-tree')).not.toHaveTextContent('Workspace · Main Agent');
  });

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
    expect(screen.getByTestId('workspace-tree')).toBeVisible();

    fireEvent.click(screen.getByText('dashboard.html'));

    const frame = await screen.findByTestId('html-preview-frame');
    expect(frame).toBeVisible();
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads',
    );
    expect(screen.queryByText('<!doctype html>')).not.toBeInTheDocument();
  });

  it('toggles directories with custom row clicks without double toggling', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    const folder = await screen.findByRole('button', { name: /^config$/i });
    expect(await screen.findByText('.config.env')).toBeVisible();

    fireEvent.click(folder);

    await waitFor(() => {
      expect(screen.queryByText('.config.env')).not.toBeInTheDocument();
    });
  });

  it('ignores virtual row background clicks and toggles directories only from the custom row button', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    const folder = await screen.findByRole('button', { name: /^config$/i });
    expect(await screen.findByText('.config.env')).toBeVisible();

    const virtualRow = folder.closest('[role="treeitem"]');
    expect(virtualRow).not.toBeNull();
    expect(virtualRow).not.toBe(folder);

    fireEvent.click(virtualRow!);

    expect(screen.getByText('.config.env')).toBeVisible();
    expect(folder).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(folder);

    await waitFor(() => {
      expect(screen.queryByText('.config.env')).not.toBeInTheDocument();
    });
    expect(folder).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps deeper nested directories closed unless included in the initial open map', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    expect(await screen.findByRole('button', { name: /^nested$/i })).toBeVisible();
    expect(screen.queryByText('.nested.env')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^nested$/i }));

    expect(await screen.findByText('.nested.env')).toBeVisible();
  });

  it('preserves collapsed directories across manual refreshes', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    const folder = await screen.findByRole('button', { name: /^config$/i });
    expect(await screen.findByText('.config.env')).toBeVisible();

    fireEvent.click(folder);

    await waitFor(() => {
      expect(screen.queryByText('.config.env')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Refresh'));

    await waitFor(() => {
      expect(loadWorkspaceTree).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('workspace-tree')).toBeVisible();
    });
    expect(screen.queryByText('.config.env')).not.toBeInTheDocument();
  });

  it('resets collapsed directories when the agent changes for the same workspace', async () => {
    const { rerender } = render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/workspace' }}
      />,
    );

    const folder = await screen.findByRole('button', { name: /^config$/i });
    expect(await screen.findByText('.config.env')).toBeVisible();

    fireEvent.click(folder);

    await waitFor(() => {
      expect(screen.queryByText('.config.env')).not.toBeInTheDocument();
    });

    rerender(
      <WorkspaceBrowserBody
        agent={{ id: 'secondary', name: 'Secondary Agent', workspace: '/workspace' }}
      />,
    );

    expect(await screen.findByText('.config.env')).toBeVisible();
  });
});
