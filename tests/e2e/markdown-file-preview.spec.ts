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
  '## Heading 2',
  '',
  '### Heading 3',
  '',
  '#### Heading 4',
  '',
  '##### Heading 5',
  '',
  '###### Heading 6',
  '',
  '---',
  '',
  '- unordered one',
  '- unordered two',
  '',
  '1. ordered one',
  '2. ordered two',
  '',
  '- [x] task one',
  '- [ ] task two',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| alpha | beta |',
  '',
  '$x^2$',
  '',
  'https://example.com。后续',
  '',
  '```javascript',
  'const highlightedValue = 42;',
  'const secondLine = highlightedValue + 1;',
  'return secondLine;',
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

      for (const level of [1, 2, 3, 4, 5, 6]) {
        const heading = preview.locator(`h${level}`);
        const margins = await heading.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return [Number.parseFloat(style.marginTop), Number.parseFloat(style.marginBottom)];
        });
        if (level === 1) expect(margins[0], 'first h1 top margin').toBe(0);
        else expect(margins[0], `h${level} top margin`).toBeGreaterThan(0);
        expect(margins[1], `h${level} bottom margin`).toBeGreaterThan(0);
      }

      const ruleMargins = await preview.locator('hr').evaluate((element) => {
        const style = window.getComputedStyle(element);
        return [Number.parseFloat(style.marginTop), Number.parseFloat(style.marginBottom)];
      });
      expect(ruleMargins[0]).toBeGreaterThan(0);
      expect(ruleMargins[1]).toBeGreaterThan(0);

      for (const firstItemText of ['unordered one', 'ordered one', 'task one']) {
        const firstItem = preview.locator('li').filter({ hasText: firstItemText }).first();
        const secondItem = firstItem.locator('xpath=following-sibling::li[1]');
        const itemGap = await firstItem.evaluate((element, nextElement) => {
          const firstRect = element.getBoundingClientRect();
          const secondRect = (nextElement as Element).getBoundingClientRect();
          return secondRect.top - firstRect.bottom;
        }, await secondItem.elementHandle());
        expect(itemGap, `${firstItemText} list gap`).toBeLessThanOrEqual(2);
        const itemPadding = await firstItem.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return [Number.parseFloat(style.paddingTop), Number.parseFloat(style.paddingBottom)];
        });
        expect(itemPadding, `${firstItemText} list padding`).toEqual([2, 2]);
        const listMargins = await firstItem.locator('..').evaluate((element) => {
          const style = window.getComputedStyle(element);
          return [Number.parseFloat(style.marginTop), Number.parseFloat(style.marginBottom)];
        });
        expect(listMargins[0], `${firstItemText} list top margin`).toBeGreaterThan(0);
        expect(listMargins[1], `${firstItemText} list bottom margin`).toBeGreaterThan(0);
        expect(listMargins[0], `${firstItemText} list top margin`).toBeLessThanOrEqual(8);
        expect(listMargins[1], `${firstItemText} list bottom margin`).toBeLessThanOrEqual(8);
      }

      const tableBorderLayers = await preview.locator('table').evaluate((table, previewRoot) => {
        const layers: string[] = [];
        let element = table.parentElement;
        while (element && element !== previewRoot) {
          const style = window.getComputedStyle(element);
          if (Number.parseFloat(style.borderTopWidth) > 0) {
            layers.push(element.getAttribute('data-streamdown') ?? element.tagName.toLowerCase());
          }
          element = element.parentElement;
        }
        return layers;
      }, await preview.elementHandle());
      expect(tableBorderLayers).toEqual([]);

      const cjkLink = preview.getByText('https://example.com', { exact: true });
      await expect(cjkLink).toBeVisible();
      await expect(cjkLink).toHaveText('https://example.com');
      await expect(cjkLink).not.toHaveAttribute('href');
      expect(await cjkLink.evaluate((element) => element.nextSibling?.textContent)).toBe('。后续');

      const javascriptBlock = preview.locator('[data-streamdown="code-block"][data-language="javascript"]');
      await expect(javascriptBlock).toContainText('const highlightedValue = 42;');
      await expect(javascriptBlock.locator('span[style*="--sdm-c"]').first()).toBeVisible();
      const codeHeader = javascriptBlock.locator('[data-streamdown="code-block-header"]');
      await expect(codeHeader).toHaveCSS('justify-content', 'flex-end');
      expect(await codeHeader.evaluate((element) => element.getBoundingClientRect().height)).toBe(28);
      const copyButton = javascriptBlock.getByTitle('Copy code');
      await expect(copyButton).toBeVisible();
      expect(await codeHeader.evaluate((header, button) => {
        const headerRect = header.getBoundingClientRect();
        const buttonRect = (button as Element).getBoundingClientRect();
        return Math.abs(
          (headerRect.top + headerRect.height / 2) - (buttonRect.top + buttonRect.height / 2),
        );
      }, await copyButton.elementHandle())).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => ({
        clipboard: typeof navigator.clipboard?.writeText === 'function',
        secureContext: window.isSecureContext,
      }))).toEqual({ clipboard: true, secureContext: true });
      await copyButton.click();
      await expect.poll(() => page.evaluate(async () => (
        await navigator.clipboard.readText()
      ).trim().replace(/\r\n?/g, '\n')))
        .toBe([
          'const highlightedValue = 42;',
          'const secondLine = highlightedValue + 1;',
          'return secondLine;',
        ].join('\n'));
      const codeBody = javascriptBlock.locator('[data-streamdown="code-block-body"] pre');
      await expect(codeBody).toHaveCSS('white-space', 'pre-wrap');
      await expect(codeBody).toHaveCSS('overflow-x', 'auto');
      await expect(codeBody).toHaveCSS('overflow-wrap', 'break-word');
      const codeLines = codeBody.locator('code > span');
      await expect(codeLines).toHaveCount(3);
      await expect(codeLines.first()).toHaveCSS('display', 'block');
      const lineTops = await codeLines.evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().top));
      expect(new Set(lineTops).size).toBe(3);

      const mermaidBlock = preview.locator('[data-streamdown="code-block"][data-language="mermaid"]');
      await expect(mermaidBlock).toContainText('graph TD');
      await expect(mermaidBlock.locator('[data-streamdown="code-block-body"] svg')).toHaveCount(0);
      await expect(preview.locator('[data-streamdown="mermaid"]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
