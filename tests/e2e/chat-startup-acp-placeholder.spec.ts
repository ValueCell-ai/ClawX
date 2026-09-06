import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX cold-start session list', () => {
  test('never flashes the Gateway ACP placeholder as session titles on cold start', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    const sessions = [
      { key: MAIN_SESSION_KEY, updatedAt: nowMs },
      { key: 'agent:main:session-alpha', updatedAt: nowMs - 1_000 },
      { key: 'agent:main:session-beta', updatedAt: nowMs - 2_000 },
    ];
    const expectedTitles = [
      { key: MAIN_SESSION_KEY, title: 'Cold start conversation 1' },
      { key: 'agent:main:session-alpha', title: 'Cold start conversation 2' },
      { key: 'agent:main:session-beta', title: 'Cold start conversation 3' },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              sessions: sessions.map((session) => ({
                ...session,
                displayName: 'ACP',
              })),
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/sessions/summaries', 'POST'])]: {
            success: true,
            summaries: sessions.map((session, index) => ({
              sessionKey: session.key,
              firstUserText: `Cold start conversation ${index + 1}`,
              lastTimestamp: session.updatedAt,
              workspacePath: null,
            })),
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.addInitScript(() => {
        const state = { sawAcpTitle: false };
        const inspect = () => {
          for (const row of document.querySelectorAll('[data-testid^="sidebar-session-"]')) {
            if (row.textContent?.includes('ACP')) state.sawAcpTitle = true;
          }
        };
        const observer = new MutationObserver(() => inspect());
        observer.observe(document, { childList: true, subtree: true, characterData: true });
        document.addEventListener('DOMContentLoaded', inspect, { once: true });
        (globalThis as unknown as {
          __acpStartupTitleObservation?: { sawAcpTitle: boolean };
        }).__acpStartupTitleObservation = state;
      });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      for (const expected of expectedTitles) {
        const sessionRow = page.getByTestId(`sidebar-session-${expected.key}`);
        await expect(sessionRow).toBeVisible({ timeout: 30_000 });
        await expect(sessionRow).toContainText(expected.title);
        await expect(sessionRow).not.toContainText('ACP');
      }

      const sawAcpTitle = await page.evaluate(() => (
        (globalThis as unknown as {
          __acpStartupTitleObservation?: { sawAcpTitle: boolean };
        }).__acpStartupTitleObservation?.sawAcpTitle ?? false
      ));
      expect(sawAcpTitle).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });
});
