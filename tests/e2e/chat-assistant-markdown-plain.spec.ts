import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElectronApplication } from '@playwright/test';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_assistant_plain_markdown.png';
const LONG_UNBROKEN_TEXT = '296bdab69b5e63143538fff2af4e5e70188e1874fdb7989cc4bf80fe37bfealaed8186184f495c20a9b360b2d8982dabe1b';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const seededUpdates: AcpSessionUpdate[] = [
  {
    sessionUpdate: 'user_message',
    messageId: 'plain-markdown-user',
    content: [{ type: 'text', text: '**Please** render `this input` literally.\n# Not a heading' }],
  },
  {
    sessionUpdate: 'agent_message',
    messageId: 'plain-markdown-assistant',
    content: [{
      type: 'text',
      text: [
        '### Plain Markdown reply',
        '',
        'This assistant reply should render as normal Markdown, not inside a gray rounded bubble.',
        '',
        '- Bold text: **works**',
        '- Inline code: `worksToo()`',
      ].join('\n'),
    }],
  },
  {
    sessionUpdate: 'user_message',
    messageId: 'long-unbroken-user',
    content: [{ type: 'text', text: LONG_UNBROKEN_TEXT }],
  },
  {
    sessionUpdate: 'agent_message',
    messageId: 'long-unbroken-assistant',
    content: [{ type: 'text', text: LONG_UNBROKEN_TEXT }],
  },
];

async function emitAcpSessionUpdates(app: ElectronApplication, updates: AcpSessionUpdate[]) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: 1,
            historical: true,
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: SESSION_KEY, updates },
  );
}

test.describe('ClawX chat Markdown styling', () => {
  test('renders assistant Markdown while keeping user input literal and bubbled', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
            },
          },
        },
        hostApi: {
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
            success: true,
            generation: 1,
          },
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
                agents: [{ id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: SESSION_KEY }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, seededUpdates);

      // Keep the text column narrow enough that the fixture must wrap on every
      // platform regardless of font metrics or the host window's default size.
      await page.setViewportSize({ width: 720, height: 800 });

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });

      const userBubble = page.getByTestId('acp-user-message').filter({ hasText: 'Please' }).locator('div.rounded-2xl.bg-brand').first();
      await expect(userBubble).toBeVisible({ timeout: 30_000 });
      await expect(userBubble.locator('p')).toHaveText('**Please** render `this input` literally.\n# Not a heading');
      await expect(userBubble.locator('strong, code, h1')).toHaveCount(0);

      const assistantProse = page.getByTestId('acp-assistant-message').filter({ hasText: 'Plain Markdown reply' }).locator('.prose').first();
      await expect(assistantProse).toBeVisible({ timeout: 30_000 });
      await expect(assistantProse.locator('strong')).toHaveText('works');
      const inlineCode = assistantProse.locator('code');
      await expect(inlineCode).toHaveText('worksToo()');
      await expect.poll(() => inlineCode.evaluate((el) => window.getComputedStyle(el).backgroundColor))
        .toBe('rgba(0, 0, 0, 0)');

      const assistantStyles = await assistantProse.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          paddingLeft: style.paddingLeft,
          paddingTop: style.paddingTop,
          parentBackgroundColor: parentStyle?.backgroundColor ?? '',
          parentBorderRadius: parentStyle?.borderRadius ?? '',
        };
      });

      expect(assistantStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyles.borderRadius).toBe('0px');
      expect(assistantStyles.paddingLeft).toBe('0px');
      expect(assistantStyles.paddingTop).toBe('0px');
      expect(assistantStyles.parentBackgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(assistantStyles.parentBorderRadius).toBe('0px');

      const longUserParagraph = page.getByTestId('acp-user-message')
        .filter({ hasText: LONG_UNBROKEN_TEXT })
        .locator('p');
      const longAssistantParagraph = page.getByTestId('acp-assistant-message')
        .filter({ hasText: LONG_UNBROKEN_TEXT })
        .locator('.prose p');
      await expect(longUserParagraph).toHaveCSS('overflow-wrap', 'anywhere');
      await expect(longAssistantParagraph).toHaveCSS('overflow-wrap', 'anywhere');

      for (const paragraph of [longUserParagraph, longAssistantParagraph]) {
        const wrapping = await paragraph.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const elementRect = element.getBoundingClientRect();
          const messageRect = element.closest('[data-testid$="-message"]')?.getBoundingClientRect();
          return {
            lineCount: range.getClientRects().length,
            left: elementRect.left,
            right: elementRect.right,
            messageLeft: messageRect?.left ?? 0,
            messageRight: messageRect?.right ?? 0,
          };
        });
        expect(wrapping.lineCount).toBeGreaterThan(1);
        expect(wrapping.left).toBeGreaterThanOrEqual(wrapping.messageLeft - 1);
        expect(wrapping.right).toBeLessThanOrEqual(wrapping.messageRight + 1);
      }

      const screenshotPath = testInfo.outputPath('chat_assistant_plain_markdown.png');
      await assistantProse.screenshot({ path: screenshotPath });
      await testInfo.attach('chat_assistant_plain_markdown', {
        path: screenshotPath,
        contentType: 'image/png',
      });

      try {
        mkdirSync(dirname(CLOUD_ARTIFACT_PATH), { recursive: true });
        copyFileSync(screenshotPath, CLOUD_ARTIFACT_PATH);
      } catch {
        // Cloud artifact directory is optional; ignore when unavailable (e.g. on CI runners).
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
