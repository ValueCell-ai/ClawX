import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_assistant_plain_markdown.png';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Please render a Markdown reply plainly.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
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
    timestamp: Date.now(),
  },
];

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
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
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
                agents: [{ id: 'main', name: 'main' }],
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

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });

      const userBubble = page.locator('div.rounded-2xl.bg-brand').filter({ hasText: 'Please render a Markdown reply plainly.' }).first();
      await expect(userBubble).toBeVisible({ timeout: 30_000 });

      const assistantProse = page.locator('.prose').filter({ hasText: 'Plain Markdown reply' }).first();
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
