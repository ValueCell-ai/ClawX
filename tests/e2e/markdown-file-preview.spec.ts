import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installAttachmentHostFixture,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const FILE_NAME = 'streamdown-preview.md';
const MARKDOWN_FIXTURE = [
  '---',
  'title: Hidden preview metadata',
  '---',
  '',
  '# Static Streamdown Preview',
  '',
  'Visible Markdown body.',
  '',
  '$x^2$',
  '',
  'https://example.com。后续',
  '',
  '```javascript',
  'const highlightedValue = 42;',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
].join('\n');

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('Markdown file preview', () => {
  test('renders workspace Markdown through static Streamdown', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Markdown preview session' }],
      });
      await fixture.createWorkspaceFile(FILE_NAME, MARKDOWN_FIXTURE);
      await fixture.setSessionReplay(MAIN_SESSION_KEY, []);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      await page.getByTestId('chat-toolbar-workspace').click();

      const panel = page.getByTestId('artifact-panel');
      const workspaceTree = panel.getByTestId('workspace-tree');
      await expect(workspaceTree).toBeVisible();
      await workspaceTree.getByTitle(FILE_NAME, { exact: true }).click();

      const preview = panel.locator('.clawx-markdown-preview');
      await expect(preview).toBeVisible();
      await expect(preview.getByRole('heading', { name: 'Static Streamdown Preview' })).toBeVisible();
      await expect(preview.getByText('Visible Markdown body.')).toBeVisible();
      await expect(preview).not.toContainText('Hidden preview metadata');
      await expect(preview.locator('.katex')).toBeVisible();

      const cjkLink = preview.getByText('https://example.com', { exact: true });
      await expect(cjkLink).toBeVisible();
      await expect(cjkLink).toHaveText('https://example.com');
      await expect(cjkLink).not.toHaveAttribute('href');
      expect(await cjkLink.evaluate((element) => element.nextSibling?.textContent)).toBe('。后续');

      const javascriptBlock = preview.locator('[data-streamdown="code-block"][data-language="javascript"]');
      await expect(javascriptBlock).toContainText('const highlightedValue = 42;');
      await expect(javascriptBlock.locator('span[style*="--sdm-c"]').first()).toBeVisible();
      const codeBody = javascriptBlock.locator('[data-streamdown="code-block-body"] pre');
      await expect(codeBody).toHaveCSS('white-space', 'pre-wrap');
      await expect(codeBody).toHaveCSS('overflow-x', 'auto');
      await expect(codeBody).toHaveCSS('overflow-wrap', 'break-word');

      const mermaidBlock = preview.locator('[data-streamdown="code-block"][data-language="mermaid"]');
      await expect(mermaidBlock).toContainText('graph TD');
      await expect(mermaidBlock.locator('svg')).toHaveCount(0);
      await expect(preview.locator('[data-streamdown="mermaid"]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
