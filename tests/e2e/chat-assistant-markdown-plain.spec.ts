import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElectronApplication } from '@playwright/test';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_assistant_plain_markdown.png';

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
    content: [{ type: 'text', text: 'Please render a Markdown reply plainly.' }],
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

test.describe('ClawX assistant reply Markdown styling', () => {
  test('renders assistant text as plain Markdown while keeping user prompts bubbled', async ({ launchElectronApp }, testInfo) => {
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
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: MAIN_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
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

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });

      const userBubble = page.getByTestId('acp-user-message').filter({ hasText: 'Please render a Markdown reply plainly.' }).locator('div.rounded-2xl.bg-brand').first();
      await expect(userBubble).toBeVisible({ timeout: 30_000 });

      const assistantProse = page.getByTestId('acp-assistant-message').filter({ hasText: 'Plain Markdown reply' }).locator('.prose').first();
      await expect(assistantProse).toBeVisible({ timeout: 30_000 });
      await expect(assistantProse.locator('strong')).toHaveText('works');
      await expect(assistantProse.locator('code')).toHaveText('worksToo()');

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
