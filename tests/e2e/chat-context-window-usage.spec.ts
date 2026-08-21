import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function baseHostApiMocks(
  loadResult: Record<string, unknown> = { success: true, generation: 1 },
) {
  return {
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey: MAIN_SESSION_KEY,
      workspaceRoot: MAIN_WORKSPACE,
      cwd: MAIN_WORKSPACE,
    }])]: loadResult,
    [stableStringify(['sessions', 'summaries', { sessionKeys: [MAIN_SESSION_KEY] }])]: { summaries: [] },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'main',
            workspace: MAIN_WORKSPACE,
            mainSessionKey: MAIN_SESSION_KEY,
          }],
        },
      },
    },
  };
}

async function installAcpChatMocks(app: ElectronApplication) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
        },
      },
    },
    hostApi: baseHostApiMocks(),
  });
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  generation = 1,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: payload.generation,
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: MAIN_SESSION_KEY, generation, updates },
  );
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('ClawX chat context window usage', () => {
  test('shows current context usage in the composer toolbar', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-context-window-usage')).toHaveCount(0);

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'usage_update',
          used: 35100,
          size: 1000000,
        },
      ]);

      await expect(page.getByTestId('chat-context-window-usage')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-context-window-usage')).toContainText('35.1k / 1M');
      await expect(page.getByTestId('chat-composer-send')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
