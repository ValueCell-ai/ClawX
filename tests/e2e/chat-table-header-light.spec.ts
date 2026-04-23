import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const tableMarkdown = [
  '| Account | Content | Heat |',
  '|---------|---------|------|',
  '| @OpenAI | ChatGPT launches Workspace Agents (shared agents) for cross-team complex workflows | 15K 2.2K RT 4.4M views |',
  '| @oran_ge | GPT Images 2 free for one week, 100 images per user, on the Labnana platform | 68 |',
  '| @caiyue5 | X now auto-detects "AI-generated" images, sparking GPT Images 2 discussion | 74 |',
  '| @fkysly | "Is the GPT Image 2 team entirely Chinese?" goes viral | 482 |',
  '| @binghe | Analyzing the possible reasons behind Claude account bans | 620 |',
  '| @turingou | "GPT Images 2 can fully replace Claude for design work" | 187 |',
  '| @DashHuang | "OpenAI is rolling out KYC" screenshot sparks discussion | — |',
].join('\n');

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Please summarize today\'s AI news on X.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        'All done — here is a quick roundup for you:',
        '',
        '**X (Twitter) following list — AI news**',
        '',
        'After clicking the **Following** tab and filtering out recommended content, here is what your followed accounts are actually posting:',
        '',
        '**Trending AI tweets**',
        '',
        tableMarkdown,
        '',
        '**Key trends:** Today\'s hottest three topics in the AI corner of X are (1) GPT Images 2 / GPT Image2, (2) Claude account bans, and (3) OpenAI Workspace Agents.',
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_table_header_light.png';

test.describe('ClawX chat table header styling', () => {
  test('renders markdown table headers with transparent background and bold text in light theme', async ({ launchElectronApp }, testInfo) => {
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
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
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

      const header = page.locator('.prose table thead th').first();
      await expect(header).toBeVisible({ timeout: 30_000 });

      const headerStyles = await header.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return { backgroundColor: style.backgroundColor, fontWeight: style.fontWeight };
      });

      expect(headerStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(Number(headerStyles.fontWeight)).toBeGreaterThanOrEqual(700);

      const tableEl = page.locator('.prose table').first();
      await tableEl.scrollIntoViewIfNeeded();

      const screenshotPath = testInfo.outputPath('chat_table_header_light.png');
      await tableEl.screenshot({ path: screenshotPath });
      await testInfo.attach('chat_table_header_light', {
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
