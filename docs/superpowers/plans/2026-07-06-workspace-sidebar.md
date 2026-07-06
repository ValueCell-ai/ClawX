# Workspace Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the workspace tab first, make hidden files always visible, replace the hand-written file tree with `react-arborist`, use material file icons, and show the current workspace path in the header.

**Architecture:** Keep `ArtifactPanel` and `WorkspaceBrowserBody` as the integration points. Replace only the tree rendering layer inside `WorkspaceBrowserBody`; keep file loading, preview rendering, sandbox checks, refresh, and file-manager actions unchanged. Add a small file-icon wrapper and a display-only workspace path formatter.

**Tech Stack:** React 19, TypeScript, Vite, Electron, Vitest, Playwright, `react-arborist`, `material-file-icons`, existing host-api file routes.

---

## Commit Policy

This environment forbids commits unless the user explicitly requests them. Do not commit while executing this plan unless the user asks for commits. At each checkpoint, inspect `git diff` and report the changed files instead.

## File Structure

- Modify: `package.json` and `pnpm-lock.yaml` to add `react-arborist` and `material-file-icons`.
- Create: `src/components/file-preview/MaterialFileIcon.tsx` as a tiny React wrapper around `material-file-icons`.
- Modify: `src/components/file-preview/ArtifactPanel.tsx` to reorder tab buttons and tab bodies.
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx` to remove hidden toggle state, always request hidden files, display `~`-compressed workspace paths, and render the tree with `react-arborist`.
- Modify: `tests/unit/artifact-panel.test.tsx` for tab-order coverage.
- Modify: `tests/unit/workspace-browser-body.test.tsx` for hidden-files-by-default, no duplicate tree title, path display, and file selection coverage.
- Modify: `tests/e2e/fixtures/electron.ts` to let E2E tests override `files.listTree` through the existing legacy IPC test seam.
- Modify: `tests/e2e/chat-file-changes.spec.ts` to cover the user-visible workspace sidebar behavior.
- Modify: `shared/i18n/locales/en/chat.json`, `shared/i18n/locales/zh/chat.json`, `shared/i18n/locales/ja/chat.json`, and `shared/i18n/locales/ru/chat.json` to remove hidden-file action strings that are no longer referenced.
- Review: `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation; edit only if they document the workspace sidebar behavior.

### Task 1: Add Dependencies And File Icon Wrapper

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/file-preview/MaterialFileIcon.tsx`

- [ ] **Step 1: Add packages**

Run:

```bash
pnpm add -D react-arborist material-file-icons
```

Expected: `package.json` and `pnpm-lock.yaml` include both packages. Use `-D` because this private Electron app already keeps renderer libraries such as React, Lucide, Monaco, and Radix under `devDependencies`.

- [ ] **Step 2: Create the icon wrapper**

Create `src/components/file-preview/MaterialFileIcon.tsx` with:

```tsx
import { useMemo } from 'react';
import { getIcon } from 'material-file-icons';
import { cn } from '@/lib/utils';

interface MaterialFileIconProps {
  filename: string;
  className?: string;
}

export function MaterialFileIcon({ filename, className }: MaterialFileIconProps) {
  const svg = useMemo(() => getIcon(filename || 'file').svg, [filename]);

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

- [ ] **Step 3: Run typecheck for the new import**

Run:

```bash
pnpm run typecheck:web
```

Expected: PASS. If TypeScript cannot find declarations for `material-file-icons`, add `src/types/material-file-icons.d.ts` with:

```ts
declare module 'material-file-icons' {
  export interface MaterialFileIconDefinition {
    name: string;
    svg: string;
    extensions?: string[];
    files?: string[];
  }

  export const defaultIcon: MaterialFileIconDefinition;
  export function getIcon(filename: string): MaterialFileIconDefinition;
  export function getAllIcons(): MaterialFileIconDefinition[];
}
```

Then rerun:

```bash
pnpm run typecheck:web
```

Expected: PASS.

### Task 2: Reorder Artifact Panel Tabs

**Files:**
- Modify: `src/components/file-preview/ArtifactPanel.tsx`
- Modify: `tests/unit/artifact-panel.test.tsx`

- [ ] **Step 1: Write the failing tab-order test**

Add this test inside `describe('ArtifactPanel', () => { ... })` in `tests/unit/artifact-panel.test.tsx`:

```tsx
  it('orders workspace before preview and changes', () => {
    useArtifactPanel.setState({
      open: true,
      tab: 'browser',
      focusedFile: null,
      widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH,
    });

    render(
      <ArtifactPanel
        files={[makeGeneratedFile()]}
        agent={{ id: 'main', name: 'Main Agent', workspace: '/Users/e2e/.openclaw/workspace-main' }}
      />,
    );

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label): label is string => label === 'Workspace' || label === 'Preview' || label === 'Changes');

    expect(labels).toEqual(['Workspace', 'Preview', 'Changes']);
  });
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-panel.test.tsx -t "orders workspace before preview and changes"
```

Expected: FAIL because current order is `Changes`, `Preview`, `Workspace`.

- [ ] **Step 3: Reorder the tab buttons and body order**

In `src/components/file-preview/ArtifactPanel.tsx`, update the header comment to list Workspace, Preview, Changes in that order. Then replace the tab-button block so the workspace button renders first:

```tsx
          {WORKSPACE_BROWSER_ENABLED && (
            <PanelTabButton
              testId="artifact-panel-tab-browser"
              icon={<FolderTree className="h-3.5 w-3.5" />}
              label={t('artifactPanel.tabs.browser', 'Workspace')}
              active={visibleTab === 'browser'}
              onClick={() => setTab('browser')}
            />
          )}
          <PanelTabButton
            testId="artifact-panel-tab-preview"
            icon={<Eye className="h-3.5 w-3.5" />}
            label={t('artifactPanel.tabs.preview', 'Preview')}
            active={visibleTab === 'preview'}
            onClick={() => setTab('preview')}
          />
          {richFocusedFile ? (
            <PanelTabButton
              testId="artifact-panel-action-open-folder"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t('generatedFiles.openFolder', 'Open folder')}
              active={false}
              onClick={handleRevealFocusedFile}
            />
          ) : (
            <PanelTabButton
              testId="artifact-panel-tab-changes"
              icon={<FileEdit className="h-3.5 w-3.5" />}
              label={t('artifactPanel.tabs.changes', 'Changes')}
              active={visibleTab === 'changes'}
              onClick={() => setTab('changes')}
            />
          )}
```

In the body region, move the workspace body before Preview and Changes so DOM order matches the tab order:

```tsx
        {WORKSPACE_BROWSER_ENABLED && (
          <div className={cn('h-full min-h-0', visibleTab !== 'browser' && 'hidden')}>
            <WorkspaceBrowserBody
              agent={agent}
              runStartedAt={runStartedAt}
              refreshSignal={refreshSignal}
              compact
            />
          </div>
        )}
        <div className={cn('h-full min-h-0', visibleTab !== 'preview' && 'hidden')}>
          <PreviewTab focusedFile={focusedFile} />
        </div>
        <div className={cn('h-full min-h-0', visibleTab !== 'changes' && 'hidden')}>
          <ChangesTab
            files={files}
            focusedFile={focusedFile}
            onFocus={(f) => setFocusedFile(f)}
            active={visibleTab === 'changes'}
          />
        </div>
```

- [ ] **Step 4: Run the focused ArtifactPanel tests**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-panel.test.tsx
```

Expected: PASS.

### Task 3: Make Hidden Files Default And Add Header Path Display

**Files:**
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx`
- Modify: `tests/unit/workspace-browser-body.test.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

- [ ] **Step 1: Update the workspace unit-test mock for hidden files**

In `tests/unit/workspace-browser-body.test.tsx`, change the workspace-tree mock so it exposes `loadWorkspaceTree` for assertions and includes a hidden file:

```tsx
const loadWorkspaceTree = vi.fn(async () => ({
  root: {
    name: 'workspace-main',
    relPath: '',
    absPath: '/Users/alex/.openclaw/workspace-main',
    isDir: true,
    children: [
      {
        name: '.env',
        relPath: '.env',
        absPath: '/Users/alex/.openclaw/workspace-main/.env',
        isDir: false,
        size: 14,
        ext: '',
        mimeType: 'application/octet-stream',
        contentType: 'text',
      },
      htmlNode,
    ],
  },
  truncated: false,
}));

vi.mock('@/lib/workspace-tree', () => ({
  loadWorkspaceTree: (...args: unknown[]) => loadWorkspaceTree(...args),
  collectInitialExpanded: vi.fn(() => new Set([''])),
  findNode: vi.fn((root: WorkspaceTreeNode, relPath: string) => {
    const walk = (node: WorkspaceTreeNode): WorkspaceTreeNode | null => {
      if (node.relPath === relPath) return node;
      for (const child of node.children ?? []) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(root);
  }),
}));
```

- [ ] **Step 2: Write the failing hidden/path/header test**

Add this test to `tests/unit/workspace-browser-body.test.tsx`:

```tsx
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
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx -t "loads hidden files by default"
```

Expected: FAIL because `includeHidden` is currently controlled by `showHidden`, the toggle exists, and the tree repeats the title.

- [ ] **Step 4: Add path formatting and remove hidden toggle state**

In `src/components/file-preview/WorkspaceBrowserBody.tsx`, remove:

```tsx
const [showHidden, setShowHidden] = useState(false);
```

Add this helper above `export function WorkspaceBrowserBody`:

```tsx
function formatWorkspacePath(workspace: string): string {
  if (!workspace) return '';

  const windowsHome = workspace.match(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/);
  if (windowsHome) {
    return `~${workspace.slice(windowsHome[0].length) || ''}`;
  }

  const normalized = workspace.replace(/\\/g, '/');
  const posixHome = normalized.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/);
  if (posixHome) {
    return `~${normalized.slice(posixHome[0].length) || ''}`;
  }

  return workspace;
}
```

Add this memo after `const workspace = agent?.workspace ?? '';`:

```tsx
  const workspaceDisplayPath = useMemo(() => formatWorkspacePath(workspace), [workspace]);
```

Change the tree loading call to always include hidden files:

```tsx
    loadWorkspaceTree(workspace, {
      runStartedAt: runStartedAt ?? null,
      includeHidden: true,
    })
```

Remove `showHidden` from that effect dependency list:

```tsx
  }, [workspace, runStartedAt, refreshTick, refreshSignal]);
```

- [ ] **Step 5: Remove the repeated tree title and hidden toggle button**

In `renderTree`, remove this block:

```tsx
        <div className="px-3 py-2 text-2xs uppercase tracking-wide text-muted-foreground">
          {t('workspace.title', 'Workspace')}
          {agent?.name ? <span className="ml-1 text-foreground/60">· {agent.name}</span> : null}
        </div>
```

In the header actions, remove the hidden toggle `<Button>` that uses `workspace.actions.toggleHidden`, `workspace.actions.hideHidden`, and `workspace.actions.showHidden`.

Change the header title group to include the path in compact and non-compact modes:

```tsx
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 truncate text-sm font-semibold">
            {t('workspace.title', 'Workspace')}
            {agent?.name ? <span className="ml-2 font-normal text-foreground/70">· {agent.name}</span> : null}
          </h2>
          {workspaceDisplayPath ? (
            <code
              data-testid="workspace-path"
              title={workspace}
              className="min-w-0 truncate rounded bg-black/5 px-2 py-0.5 text-2xs text-muted-foreground dark:bg-white/10"
            >
              {workspaceDisplayPath}
            </code>
          ) : null}
        </div>
```

- [ ] **Step 6: Remove unused i18n action keys**

In each `shared/i18n/locales/*/chat.json`, change the `workspace.actions` object from four entries to two entries:

```json
"actions": {
  "refresh": "Refresh",
  "openRootInFinder": "Reveal workspace in file manager"
}
```

Use the existing translations for `refresh` and `openRootInFinder` in `zh`, `ja`, and `ru`; remove only `toggleHidden`, `showHidden`, and `hideHidden`.

- [ ] **Step 7: Run the focused workspace test**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx -t "loads hidden files by default"
```

Expected: PASS.

### Task 4: Replace The Hand-Written Tree With React Arborist

**Files:**
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx`
- Modify: `tests/unit/workspace-browser-body.test.tsx`

- [ ] **Step 1: Write the failing file-selection regression test**

Keep the existing HTML preview test and add this assertion after `await waitFor(() => { expect(screen.getByText('dashboard.html')).toBeVisible(); });`:

```tsx
    expect(screen.getByTestId('workspace-tree')).toBeVisible();
```

The existing click and preview assertions remain the regression test for selection:

```tsx
    fireEvent.click(screen.getByText('dashboard.html'));

    const frame = await screen.findByTestId('html-preview-frame');
    expect(frame).toBeVisible();
```

- [ ] **Step 2: Run the workspace unit tests before refactor**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS before code changes after Task 3. This establishes the regression baseline.

- [ ] **Step 3: Import Arborist and measurement hooks**

In `src/components/file-preview/WorkspaceBrowserBody.tsx`, change the imports at the top:

```tsx
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
```

Add:

```tsx
import { MaterialFileIcon } from './MaterialFileIcon';
```

- [ ] **Step 4: Add tree height measurement**

Inside `WorkspaceBrowserBody`, after existing state declarations, add:

```tsx
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [treeHeight, setTreeHeight] = useState(0);
```

Add this effect after the agent reset effect:

```tsx
  useLayoutEffect(() => {
    const element = treeContainerRef.current;
    if (!element) return;

    const updateHeight = () => {
      setTreeHeight(Math.max(1, Math.floor(element.clientHeight)));
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
```

- [ ] **Step 5: Add Arborist open-state conversion**

Above `export function WorkspaceBrowserBody`, add:

```tsx
function toOpenState(expanded: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of expanded) {
    if (id) out[id] = true;
  }
  return out;
}
```

Inside `WorkspaceBrowserBody`, add this memo after `selectedNode`:

```tsx
  const initialOpenState = useMemo(() => {
    if (state.status !== 'ready') return {};
    return toOpenState(collectInitialExpanded(state.root, 1));
  }, [state]);
```

Remove the old `expanded` state and `toggleNode` callback.

- [ ] **Step 6: Replace `renderTree` ready-state output**

Replace the ready branch of `renderTree` with:

```tsx
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div ref={treeContainerRef} data-testid="workspace-tree" className="min-h-0 flex-1">
          {treeHeight > 0 && (
            <Tree<WorkspaceTreeNode>
              key={`${workspace}:${refreshTick}:${refreshSignal ?? 0}`}
              data={state.root.children ?? []}
              idAccessor={(node) => node.relPath}
              childrenAccessor={(node) => node.children ?? null}
              selection={selectedRel ?? undefined}
              initialOpenState={initialOpenState}
              disableDrag
              disableDrop
              disableEdit
              disableMultiSelection
              height={treeHeight}
              width="100%"
              rowHeight={compact ? 24 : 28}
              indent={14}
              overscanCount={8}
              onActivate={(node) => {
                if (node.data.isDir) {
                  node.toggle();
                  return;
                }
                setSelectedRel(node.data.relPath);
              }}
            >
              {WorkspaceTreeRow}
            </Tree>
          )}
        </div>
        {state.truncated && (
          <div className="shrink-0 px-3 py-2 text-2xs text-muted-foreground/80">
            {t('workspace.truncated', 'Directory too large; truncated to first 5000 nodes')}
          </div>
        )}
      </div>
    );
```

- [ ] **Step 7: Replace manual tree row components**

Delete `FileTreeNodeList`, `FileTreeNodeRow`, and their prop interfaces. Add this component near the bottom of `WorkspaceBrowserBody.tsx`:

```tsx
function WorkspaceTreeRow({ node, style }: NodeRendererProps<WorkspaceTreeNode>) {
  const data = node.data;

  const handleClick = () => {
    if (data.isDir) {
      node.toggle();
      return;
    }
    node.activate();
  };

  return (
    <div style={style} className="px-1">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex h-full w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
          node.isSelected
            ? 'bg-black/5 text-foreground dark:bg-white/10'
            : 'text-foreground hover:bg-black/5 dark:hover:bg-white/10',
        )}
        title={data.relPath || data.name}
      >
        <span className="flex shrink-0 items-center" style={{ width: Math.max(0, node.level) * 14 }} />
        {data.isDir ? (
          <>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                node.isOpen && 'rotate-90',
              )}
            />
            {node.isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
            )}
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <MaterialFileIcon filename={data.name} className="h-3.5 w-3.5" />
          </>
        )}
        <span className={cn('min-w-0 flex-1 truncate', data.isDir && 'font-medium')}>{data.name}</span>
        {!data.isDir && data.isFresh && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        )}
      </button>
    </div>
  );
}
```

If `lucide-react` reports the `File` import as unused, remove `File` from the import list.

- [ ] **Step 8: Use material icons in the selected-file header**

In the selected-file header, replace `FilePreviewIcon` with:

```tsx
                <MaterialFileIcon filename={selectedNode.name} className="h-4 w-4" />
```

Then remove `FilePreviewIcon` from the imports if it is no longer used in `WorkspaceBrowserBody.tsx`.

- [ ] **Step 9: Run workspace tests after the refactor**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS. If jsdom does not define `ResizeObserver`, the fallback branch should still set a positive height from the container and render the tree.

### Task 5: Add Electron E2E Coverage

**Files:**
- Modify: `tests/e2e/fixtures/electron.ts`
- Modify: `tests/e2e/chat-file-changes.spec.ts`

- [ ] **Step 1: Add `file:listTree` override support to the E2E fixture**

In `tests/e2e/fixtures/electron.ts`, after `const originalLegacyFileReadText = getInvokeHandler('file:readText');`, add:

```ts
      const originalLegacyFileListTree = getInvokeHandler('file:listTree');
```

Inside the `if (request?.module === 'files')` block, after the `readText` branch, add:

```ts
            if (request.action === 'listTree') {
              const legacyFileListTree = getLegacyOverride('file:listTree', originalLegacyFileListTree);
              if (legacyFileListTree) {
                return respond(request.id, await legacyFileListTree(event, path, payload.opts));
              }
            }
```

- [ ] **Step 2: Add the E2E test data**

In `tests/e2e/chat-file-changes.spec.ts`, add this constant near the existing histories:

```ts
const workspacePath = '/Users/e2e/.openclaw/workspace-main';
```

- [ ] **Step 3: Write the E2E test**

Add this test inside `test.describe('ClawX chat file changes', () => { ... })`:

```ts
  test('shows workspace first with hidden files and compressed path', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: history },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main Agent', workspace: workspacePath }],
              },
            },
          },
        },
      });

      await app.evaluate(async ({ workspacePath: mockedWorkspacePath }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('file:listTree');
        ipcMain.handle('file:listTree', async (_event: unknown, inputPath: string, opts?: { includeHidden?: boolean }) => {
          if (inputPath !== mockedWorkspacePath || opts?.includeHidden !== true) {
            return { ok: false, error: 'unexpectedListTreeRequest' };
          }
          return {
            ok: true,
            root: {
              name: 'workspace-main',
              relPath: '',
              absPath: mockedWorkspacePath,
              isDir: true,
              children: [
                {
                  name: '.env',
                  relPath: '.env',
                  absPath: `${mockedWorkspacePath}/.env`,
                  isDir: false,
                  size: 16,
                  mtime: Date.now(),
                },
                {
                  name: 'demo.ts',
                  relPath: 'demo.ts',
                  absPath: `${mockedWorkspacePath}/demo.ts`,
                  isDir: false,
                  size: 24,
                  mtime: Date.now(),
                },
              ],
            },
            truncated: false,
          };
        });
      }, { workspacePath });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const fileCard = page.getByRole('button', { name: /demo\.ts/ }).first();
      await expect(fileCard).toBeVisible({ timeout: 30_000 });
      await fileCard.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      const tabLabels = await sidePanel.locator('[data-testid^="artifact-panel-tab-"]').evaluateAll((buttons) => (
        buttons.map((button) => button.textContent?.trim())
      ));
      expect(tabLabels).toEqual(['Workspace', 'Preview', 'Changes']);

      await sidePanel.getByTestId('artifact-panel-tab-browser').click();
      await expect(sidePanel.getByTestId('workspace-path')).toHaveText('~/.openclaw/workspace-main');
      await expect(sidePanel.getByRole('button', { name: /hidden files/i })).toHaveCount(0);
      await expect(sidePanel.getByText('.env')).toBeVisible({ timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 4: Run the E2E test**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts -g "shows workspace first with hidden files and compressed path"
```

Expected: PASS. If the app build is stale, run:

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts -g "shows workspace first with hidden files and compressed path"
```

Expected: PASS.

### Task 6: Full Verification And Docs Review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Review: all changed files from Tasks 1-5

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-panel.test.tsx tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm run lint
```

Expected: PASS. If ESLint changes formatting, inspect `git diff` afterward.

- [ ] **Step 4: Run focused E2E**

Run:

```bash
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts -g "shows workspace first with hidden files and compressed path"
```

Expected: PASS.

- [ ] **Step 5: Review README files**

Open `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. If none mention the artifact panel workspace tree, make no README edits. If any mention hidden-file toggles or the workspace tab order, update those exact descriptions to match: Workspace first, hidden files always shown, path displayed in the header.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff --stat
git diff
```

Expected: The diff contains only dependency updates, workspace sidebar code, i18n cleanup, tests, and docs/plans/specs created for this task.

## Self-Review

- Spec coverage: The plan covers tab ordering, hidden-file behavior, Arborist replacement, material icons, duplicate title removal, `~` path display, i18n cleanup, unit tests, E2E tests, and README review.
- Placeholder scan: No placeholder sections remain; each code-changing step includes concrete code or exact commands.
- Type consistency: `selectedRel`, `WorkspaceTreeNode`, `MaterialFileIcon`, `formatWorkspacePath`, `workspace-path`, and `workspace-tree` are used consistently across implementation and tests.
