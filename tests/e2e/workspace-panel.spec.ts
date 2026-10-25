import { closeElectronApp, expect, getStableWindow, installAttachmentHostFixture, test } from './fixtures/electron';
import { E2E_EXCLUSIVE_TAG } from './parallel-policy';

const SESSION = 'agent:main:main';
const localeCases = [
  { language: 'en', source: 'Source' },
  { language: 'zh', source: '源码' },
  { language: 'ja', source: 'ソース' },
  { language: 'ru', source: 'Исходный код' },
];

// This flow exercises Copy path using the real system clipboard.
test.describe('Workspace panel refinement', { tag: E2E_EXCLUSIVE_TAG }, () => {
  for (const locale of localeCases) {
    test(`shares file focus, finds task files and adapts to narrow windows in ${locale.language}`, async ({ launchElectronApp }, testInfo) => {
      const app = await launchElectronApp({ skipSetup: true });
      try {
        const fixture = await installAttachmentHostFixture(app, { sessions: [{ key: SESSION, title: 'Workspace panel test' }] });
        const [readmePath] = await Promise.all([
          fixture.createWorkspaceFile('readme.txt', 'Workspace readme content'),
          fixture.createWorkspaceFile('nested/summary.md', '# Workspace summary\n\nTask output'),
          fixture.createWorkspaceFile('.hidden-note.txt', 'Hidden fixture'),
          fixture.createWorkspaceFile('sample.html', '<!doctype html><html><body><h1>Workspace HTML</h1></body></html>'),
        ]);
        await fixture.setSessionReplay(SESSION, [
          { sessionUpdate: 'user_message', messageId: 'workspace-user', content: [{ type: 'text', text: 'Prepare the workspace summary' }] },
          { sessionUpdate: 'tool_call', toolCallId: 'write-summary', title: 'Write: nested/summary.md', status: 'in_progress', rawInput: { path: 'nested/summary.md', content: '# Workspace summary' }, content: [] },
          { sessionUpdate: 'tool_call_update', toolCallId: 'write-summary', title: 'Write: nested/summary.md', status: 'completed', content: [] },
        ]);
        await fixture.setTranscriptResponses(SESSION, [[]]);
        await app.evaluate(({ ipcMain }, language) => {
          type Request = { id: string; module: string; action: string };
          const registry = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<{ data?: Record<string, unknown> }>> };
          const original = registry._invokeHandlers.get('host:invoke')!;
          ipcMain.removeHandler('host:invoke');
          ipcMain.handle('host:invoke', async (event, request: Request) => {
            const result = await original(event, request);
            if (request.module === 'settings' && request.action === 'getAll' && result.data) {
              result.data.language = language;
              result.data.theme = language === 'ru' ? 'dark' : 'light';
            }
            return result;
          });
        }, locale.language);
        const page = await getStableWindow(app);
        await page.reload();
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.getByTestId('chat-toolbar-workspace').click();
        const panel = page.getByTestId('artifact-panel');
        const tree = panel.getByTestId('workspace-tree');
        const search = panel.getByTestId('workspace-file-search');
        await expect(tree).toBeVisible();
        await expect(tree.getByTitle('nested/summary.md', { exact: true })).toHaveCount(0);
        await expect(tree.getByTitle('.hidden-note.txt', { exact: true })).toHaveCount(0);
        await search.fill('summary');
        await tree.getByTitle('nested/summary.md', { exact: true }).click();
        await expect(panel.getByRole('heading', { name: 'Workspace summary', exact: true })).toBeVisible();
        await expect(tree.getByTitle('nested/summary.md', { exact: true })).toHaveClass(/bg-primary\/10/);
        await panel.getByTestId('artifact-panel-tab-preview').click();
        await expect(panel.getByRole('heading', { name: 'Workspace summary', exact: true })).toBeVisible();
        await expect(panel.getByTestId('file-preview-header')).toHaveCount(1);
        await panel.getByTestId('artifact-panel-tab-browser').click();
        await search.fill('sample.html');
        await tree.getByTitle('sample.html', { exact: true }).click();
        await expect(panel.getByTestId('artifact-panel-tab-browser')).toHaveAttribute('aria-selected', 'true');
        await expect(panel.getByTestId('file-preview-header').getByRole('heading', { name: 'sample.html', exact: true })).toBeVisible();
        await expect(page.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'false');
        // Native guest navigation restrictions are also covered by the dedicated E2E suite.
        await search.fill('readme');
        await tree.getByTitle('readme.txt', { exact: true }).click();
        await expect(panel.getByTestId('file-preview-header').getByRole('heading', { name: 'readme.txt', exact: true })).toBeVisible();
        await search.fill('');
        await panel.getByTestId('workspace-view-recent').click();
        await expect(panel.getByTestId('workspace-quick-file-readme.txt')).toBeVisible();
        await expect(panel.getByTestId('workspace-quick-file-nested/summary.md')).toBeVisible();
        await panel.getByTestId('workspace-view-task').click();
        await expect(panel.getByTestId('workspace-quick-file-nested/summary.md')).toBeVisible();
        await expect(panel.getByTestId('workspace-quick-file-readme.txt')).toHaveCount(0);
        await expect(panel.getByTestId('artifact-panel-changes-count')).toHaveText('1');
        await panel.getByTestId('artifact-panel-tab-changes').click();
        await expect(panel.getByTestId('acp-change-file-group')).toHaveCount(1);
        await panel.getByTestId('artifact-panel-tab-browser').click();
        await panel.getByTestId('workspace-view-all').click();
        await panel.getByTestId('workspace-show-hidden').click();
        await expect(tree.getByTitle('.hidden-note.txt', { exact: true })).toBeVisible();
        await search.fill('no-such-fixture');
        await expect(tree.getByRole('treeitem')).toHaveCount(0);
        await search.fill('');
        const divider = panel.getByTestId('workspace-tree-divider');
        const originalWidth = Number(await divider.getAttribute('aria-valuenow'));
        await divider.focus();
        await page.keyboard.press('ArrowRight');
        await expect(divider).toHaveAttribute('aria-valuenow', String(originalWidth + 16));
        const dividerBounds = await divider.boundingBox();
        if (!dividerBounds) throw new Error('File divider has no bounds');
        await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + 80);
        await page.mouse.down();
        await page.mouse.move(dividerBounds.x + 24, dividerBounds.y + 80, { steps: 3 });
        await page.mouse.up();
        await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(originalWidth + 24);
        await panel.getByTestId('workspace-collapse-all').click();
        await expect(tree.getByTitle('nested/summary.md', { exact: true })).toHaveCount(0);
        await panel.getByTestId('file-preview-fullscreen-toggle').click();
        await expect(page.getByTestId('file-preview-fullscreen-layer')).toBeVisible();
        await expect(page.getByTestId('file-preview-header')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('file-preview-fullscreen-layer')).toHaveCount(0);
        if (locale.language === 'en') {
          await panel.getByTestId('file-preview-actions').click();
          await page.getByRole('menuitem', { name: 'Copy path', exact: true }).click();
          expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(readmePath);
          await panel.getByTestId('file-preview-actions').click();
          await page.getByRole('menuitem', { name: 'Reveal in file manager', exact: true }).click();
          await expect.poll(async () => (await fixture.getHostInvocations()).filter(call => call.module === 'files' && call.action === 'revealWorkspaceFile').length).toBe(1);
          expect((await fixture.getShellInvocations()).some(call => call.action === 'showItemInFolder')).toBe(true);
          expect((await fixture.getHostInvocations()).filter(call => call.module === 'files' && call.action === 'readText')).toHaveLength(0);
        }
        await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });
        await page.setViewportSize({ width: 900, height: 700 });
        await expect(page.getByTestId('artifact-panel-aside')).toBeVisible();
        await expect(page.getByTestId('artifact-panel-aside')).toHaveAttribute('role', 'dialog');
        await panel.getByTestId('file-preview-fullscreen-toggle').click();
        await expect(page.getByTestId('file-preview-fullscreen-layer')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('file-preview-fullscreen-layer')).toHaveCount(0);
        await expect(panel).toBeVisible();
        await page.setViewportSize({ width: 480, height: 700 });
        await panel.getByTestId('workspace-back-to-files').click();
        await expect(search).toBeVisible();
        await search.fill('readme');
        await tree.getByTitle('readme.txt', { exact: true }).click();
        await expect(panel.getByTestId('file-preview-header').getByRole('heading', { name: 'readme.txt', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('workspace-narrow.png') });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('artifact-panel-aside')).toHaveCount(0);
        await expect(page.getByTestId('chat-toolbar-workspace')).toBeFocused();
      } finally { await closeElectronApp(app); }
    });
  }
});
