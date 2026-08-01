import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElectronApplication } from '@playwright/test';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

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

const seededUpdates: AcpSessionUpdate[] = [
  {
    sessionUpdate: 'user_message',
    messageId: 'table-header-user',
    content: [{ type: 'text', text: 'Please summarize today\'s AI news on X.' }],
  },
  {
    sessionUpdate: 'agent_message',
    messageId: 'table-header-assistant',
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

const CLOUD_ARTIFACT_PATH = '/opt/cursor/artifacts/chat_table_header_light.png';

test.describe('ClawX chat table header styling', () => {
  test('renders transparent light and muted dark Markdown table headers', async ({ launchElectronApp }, testInfo) => {
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

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });

      const headerParent = page.locator('.prose table thead').first();
      const headerCell = headerParent.locator('th').first();
      await expect(headerCell).toBeVisible({ timeout: 30_000 });

      const lightHeaderStyles = await headerParent.evaluate((element) => {
        const cell = element.querySelector('th');
        if (!cell) throw new Error('Markdown table header cell is missing');
        const parentStyle = window.getComputedStyle(element);
        const cellStyle = window.getComputedStyle(cell);
        return {
          parentBackgroundColor: parentStyle.backgroundColor,
          cellBackgroundColor: cellStyle.backgroundColor,
          cellFontWeight: cellStyle.fontWeight,
        };
      });

      expect(lightHeaderStyles.parentBackgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(lightHeaderStyles.cellBackgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(Number(lightHeaderStyles.cellFontWeight)).toBeGreaterThanOrEqual(700);

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

      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('light');
        root.classList.add('dark');
      });
      const darkHeaderStyles = await headerParent.evaluate((element) => {
        const cell = element.querySelector('th');
        if (!cell) throw new Error('Markdown table header cell is missing');
        const mutedProbe = document.createElement('div');
        mutedProbe.className = 'bg-muted';
        document.body.appendChild(mutedProbe);
        const mutedBackgroundColor = window.getComputedStyle(mutedProbe).backgroundColor;
        mutedProbe.remove();
        return {
          parentBackgroundColor: window.getComputedStyle(element).backgroundColor,
          cellBackgroundColor: window.getComputedStyle(cell).backgroundColor,
          mutedBackgroundColor,
        };
      });

      expect(darkHeaderStyles.parentBackgroundColor).toBe(darkHeaderStyles.mutedBackgroundColor);
      expect(darkHeaderStyles.cellBackgroundColor).toBe(darkHeaderStyles.mutedBackgroundColor);
    } finally {
      await closeElectronApp(app);
    }
  });
});
