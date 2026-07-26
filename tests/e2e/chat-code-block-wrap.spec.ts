import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

// Regression: assistant code blocks used to set only `overflow-x-auto`, which
// hid long log lines (gateway diagnostics, file paths, etc.) behind a
// horizontal scroll that the chat viewport often clipped on narrower windows.
// The fenced `<pre>` must now soft-wrap so the full line is visible without
// requiring horizontal scrolling.

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';

const LONG_LOG_LINE = 'config change requires channel reload (wecom) — deferring until 2 operation(s), 1 reply(ies), 1 embedded run(s) complete';
const LONG_PATH = '/Users/guoyuliang/.openclaw/agents/main/sessions/6a9f6ff8-91e7-4532-bfe0-4393e6aa120d.jsonl';

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
    messageId: 'code-wrap-user',
    content: [{ type: 'text', text: 'Show me the gateway log line.' }],
  },
  {
    sessionUpdate: 'agent_message',
    messageId: 'code-wrap-assistant',
    content: [{
      type: 'text',
      text: [
        'Here is the relevant log entry:',
        '',
        '```',
        LONG_LOG_LINE,
        LONG_PATH,
        '```',
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

test.describe('ClawX chat code block wrapping', () => {
  test('soft-wraps long lines inside fenced code blocks instead of overflowing', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }] },
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
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: SESSION_KEY }] },
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

      // Constrain the viewport so the long line cannot fit on a single visual
      // row; without wrapping, this would force horizontal overflow.
      await page.setViewportSize({ width: 720, height: 800 });

      const assistantProse = page.getByTestId('acp-assistant-message').filter({ hasText: 'Here is the relevant log entry' }).locator('.prose').first();
      await expect(assistantProse).toBeVisible({ timeout: 30_000 });

      const codeBlock = assistantProse.locator('pre').first();
      await expect(codeBlock).toBeVisible();

      const metrics = await codeBlock.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap || (style as unknown as { wordWrap: string }).wordWrap,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });

      // `whitespace-pre-wrap` collapses to `pre-wrap`; `break-words` collapses
      // to `overflow-wrap: break-word`. Together they make long log lines wrap
      // softly while still preserving the leading whitespace of source code.
      expect(metrics.whiteSpace).toBe('pre-wrap');
      expect(metrics.overflowWrap).toBe('break-word');

      // Wrapping must keep the rendered content within the viewport — i.e. no
      // horizontal scroll needed for plain log lines.
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

      await expect(codeBlock).toContainText(LONG_LOG_LINE);
      await expect(codeBlock).toContainText(LONG_PATH);
    } finally {
      await closeElectronApp(app);
    }
  });
});
