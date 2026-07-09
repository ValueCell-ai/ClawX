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

const seededUpdates: AcpSessionUpdate[] = [
  {
    sessionUpdate: 'user_message',
    messageId: 'latex-user',
    content: [{ type: 'text', text: 'Show me Einstein\'s mass-energy equivalence and a definite integral.' }],
  },
  {
    sessionUpdate: 'agent_message',
    messageId: 'latex-assistant',
    content: [{
      type: 'text',
      text: [
        'Sure! Einstein famously wrote $E=mc^2$, and the quadratic formula is \\(x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\).',
        '',
        'A definite integral:',
        '',
        '$$',
        '\\int_0^1 x\\,dx = \\frac{1}{2}',
        '$$',
        '',
        'And a sum with bracket-style block math:',
        '',
        '\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]',
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

test.describe('ClawX chat LaTeX rendering', () => {
  test('renders KaTeX markup for $...$, $$...$$, \\(...\\) and \\[...\\] delimiters', async ({ launchElectronApp }) => {
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

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });

      // Wait for a KaTeX inline rendering to appear.
      await expect(timeline.locator('.katex').first()).toBeVisible({ timeout: 30_000 });
      // Inline math: $E=mc^2$
      await expect(timeline.locator('.katex').filter({ hasText: /E\s*=\s*mc/ }).first()).toBeVisible();
      // Display math: both $$...$$ and \[...\] forms produce .katex-display blocks.
      await expect(timeline.locator('.katex-display')).toHaveCount(2);
    } finally {
      await closeElectronApp(app);
    }
  });
});
