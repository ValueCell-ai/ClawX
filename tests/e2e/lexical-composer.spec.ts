import { test, expect, completeSetup, installIpcMocks } from './fixtures/electron';
import { settleFloatingSurface } from './fixtures/floating-ui';

const docxDescription = 'Create and revise Word documents, apply consistent formatting, organize sections and tables, and extract text and images from existing files. Review tracked changes, update comments, and prepare the final document for sharing.';
const skills = ['docx', 'pdf', 'skill-creator'].map(name => ({
  name,
  description: name === 'docx' ? docxDescription : `Work with ${name}`,
  source: 'workspace',
  sourceLabel: 'Workspace',
  manifestPath: `/tmp/composer/${name}/SKILL.md`,
  baseDir: `/tmp/composer/${name}`,
}));
test.beforeEach(async ({ electronApp, page }) => {
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    hostApi: {
      '["/api/agents","GET"]': { success: true, agents: [{ id: 'main', name: 'Main', workspace: '/tmp/composer', mainSessionKey: 'agent:main:main' }, { id: 'research', name: 'Research', workspace: '/tmp/research', mainSessionKey: 'agent:research:main' }] },
      '["/api/skills/quick-access","POST"]': { success: true, skills },
    },
  });
  await electronApp.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Handler = (event: unknown, request: { id: string; module: string; action: string; payload?: unknown }) => Promise<unknown>;
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('host:invoke')!;
    const prompts: unknown[] = [];
    (globalThis as unknown as { composerPrompts: unknown[] }).composerPrompts = prompts;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request) => {
      if (request.module === 'files' && request.action === 'stageBuffer') {
        return { id: request.id, ok: true, data: { id: 'pasted', fileName: 'notes.txt', mimeType: 'text/plain', fileSize: 5, stagedPath: '/tmp/notes.txt', preview: null } };
      }
      if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
        prompts.push(request.payload);
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      if (request.module === 'chat' && request.action === 'loadAcpSession') return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      return original(event, request);
    });
  });
  await completeSetup(page);
  await page.getByTestId('sidebar-new-chat').click();
  await expect(page.getByTestId('chat-home-skill-docx')).toBeEnabled();
});

test('slash suggestions keep focus, support pointer and keyboard, dismiss and animate', async ({ page }, testInfo) => {
  const input = page.getByTestId('chat-composer-input');
  const composer = page.getByTestId('chat-composer');
  const menu = page.getByTestId('chat-composer-input-slash-menu');
  await input.pressSequentially('/');
  await expect(menu).toBeVisible();
  const results = menu.getByRole('listbox');
  await expect(results).toHaveCSS('scroll-behavior', 'smooth');
  const description = page.getByTestId('chat-composer-input-slash-docx-description');
  await expect(description).toHaveText(docxDescription);
  await expect(page.getByTestId('chat-composer-input-slash-docx-source')).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(await menu.evaluate(el => getComputedStyle(el).animationDuration)).toBe('0.14s');
  await settleFloatingSurface(menu);
  for (const width of [1280, 880]) {
    await page.setViewportSize({ width, height: 720 });
    await expect.poll(async () => {
      const [panel, box] = await Promise.all([menu.boundingBox(), composer.boundingBox()]);
      if (!panel || !box) return false;
      return Math.abs(panel.x - box.x) < 1
        && Math.abs(panel.width - box.width) < 1
        && Math.abs(box.y - (panel.y + panel.height) - 4) < 1;
    }).toBe(true);
  }
  await expect(description).toHaveCSS('height', '16px');
  await expect(description).toHaveCSS('text-overflow', 'ellipsis');
  await expect(menu.locator('kbd')).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('chat-composer-input-slash-pdf')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/pdf');
  await expect(input).toBeFocused();
  await expect(menu).toHaveCount(0);
  await input.fill('/doc');
  await expect(page.getByTestId('chat-composer-input-slash-docx')).toBeVisible();
  await page.getByTestId('chat-composer-input-slash-docx').click();
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/docx');
  await input.fill('/');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(input).toHaveText('/');
  await expect(input).toBeFocused();
  await input.fill('/pd');
  await expect(menu).toBeVisible();
  await page.getByTestId('sidebar-brand').click();
  await expect(menu).toHaveCount(0);
  await input.fill('/doc');
  await expect(menu).toBeVisible();
  await settleFloatingSurface(menu);
  await page.screenshot({ path: testInfo.outputPath('slash-skills.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(menu).toHaveCSS('animation-name', 'none');
  await expect(results).toHaveCSS('scroll-behavior', 'auto');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('tokens delete atomically, undo and copy/paste without an overlay', async ({ page }) => {
  const input = page.getByTestId('chat-composer-input');
  await input.fill('draft');
  await page.getByTestId('chat-home-skill-docx').click();
  await input.press('Home');
  await input.press('ArrowRight');
  await input.press('Delete');
  await input.press('ControlOrMeta+z');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(1);
  // Place the native selection immediately after the token's separator.
  await input.evaluate(el => {
    const token = el.querySelector('[data-clawx-skill]')!;
    const next = token.nextSibling!.firstChild!;
    const range = document.createRange(); range.setStart(next, 2); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await input.press('Backspace');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(0);
  await expect(input).toHaveText('draft');
  await input.press('ControlOrMeta+z');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(1);
  // Use the actual browser clipboard events with a test-local DataTransfer.
  await input.press('ControlOrMeta+a');
  const copied = await input.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return { text: data.getData('text/plain'), lexical: data.getData('application/x-lexical-editor') };
  });
  expect(copied.text).toContain('/docx');
  expect(copied.lexical).toContain('clawx-skill');
  await input.fill('');
  await input.evaluate((el, copied) => {
    const data = new DataTransfer(); data.setData('text/plain', copied.text); data.setData('application/x-lexical-editor', copied.lexical);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, copied);
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(1);
  await expect(input).toHaveText('/docx  draft');
  await expect(page.getByTestId('chat-composer-highlight')).toHaveCount(0);
});

test('does not tokenize paths or send unknown slash queries; sends the selected skill as plain text', async ({ page, electronApp }) => {
  const input = page.getByTestId('chat-composer-input');
  const menu = page.getByTestId('chat-composer-input-slash-menu');
  await input.fill('/Users/me/file');
  await expect(menu).toHaveCount(0);
  await input.fill('explain /docx');
  await expect(menu).toHaveCount(0);
  await input.fill('/unknown');
  await expect(menu).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveText('/unknown');
  expect(await electronApp.evaluate(() => (globalThis as unknown as { composerPrompts: unknown[] }).composerPrompts.length)).toBe(0);
  await input.fill('/doc');
  await input.press('Enter');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(1);
  await page.keyboard.type('你好');
  await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true })));
  await expect(input).toContainText('你好');
  await input.press('Shift+Enter');
  await page.keyboard.type('second line');
  await input.press('Enter');
  await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { composerPrompts: unknown[] }).composerPrompts)).toHaveLength(1);
  const payload = await electronApp.evaluate(() => (globalThis as unknown as { composerPrompts: unknown[] }).composerPrompts[0]);
  expect(JSON.stringify(payload)).toContain('/docx  你好');
  expect(JSON.stringify(payload)).not.toContain('clawx-skill');
  await expect(input).toHaveText('');
});

test('pastes file attachments and accompanying text without replacing the skill', async ({ page }) => {
  const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-home-skill-docx').click();
  await input.evaluate(el => {
    const data = new DataTransfer();
    data.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    data.setData('text/plain', 'read this');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('chat-composer-attachments')).toContainText('notes.txt');
  await expect(input).toContainText('/docx  read this');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(1);
  await expect(page.getByTestId('chat-composer-attachments')).not.toContainText('Staging');
});

test('keeps skill tokens and unsent content when selecting a different Agent', async ({ page }) => {
  const input = page.getByTestId('chat-composer-input');
  await input.fill('my task');
  await page.getByTestId('chat-home-skill-docx').click();
  await page.getByTestId('chat-composer-agent').click();
  await page.getByTestId('chat-agent-option-research').click();
  await expect(page.getByTestId('chat-composer-agent')).toContainText('Research');
  await expect(input).toHaveText('/docx  my task');
  await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/docx');
  await input.press('End');
  await page.keyboard.type(' continued');
  await expect(input).toContainText('my task continued');
});
