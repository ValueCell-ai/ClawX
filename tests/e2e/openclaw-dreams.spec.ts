import type { Page } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function buildDreamingEnabledPatchRaw(enabled: boolean): string {
  return JSON.stringify({
    plugins: {
      entries: {
        'memory-core': {
          config: {
            dreaming: {
              enabled,
            },
          },
        },
      },
    },
  });
}

async function enableDeveloperMode(page: Page): Promise<void> {
  await page.getByTestId('sidebar-nav-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  const devModeToggle = page.getByTestId('settings-dev-mode-switch');
  if ((await devModeToggle.getAttribute('data-state')) !== 'checked') {
    await devModeToggle.click();
  }
  await expect(devModeToggle).toHaveAttribute('data-state', 'checked');
}

test.describe('OpenClaw Dreams', () => {
  const dreamsRpcMocks = {
    [stableStringify(['sessions.list', {}])]: {
      success: true,
      result: { sessions: [] },
    },
    [stableStringify(['doctor.memory.status', {}])]: {
      success: true,
      result: {
        dreaming: {
          enabled: true,
          timezone: 'Asia/Shanghai',
          storageMode: 'inline',
          shortTermCount: 2,
          groundedSignalCount: 1,
          totalSignalCount: 3,
          promotedToday: 1,
          phases: {
            light: {
              enabled: true,
              cron: '0 * * * *',
              nextRunAtMs: Date.parse('2026-05-01T03:00:00Z'),
            },
            rem: { enabled: false },
            deep: { enabled: true, cron: '0 3 * * *' },
          },
          shortTermEntries: [
            {
              key: 'native-dreams-ui',
              path: 'memory/dreams/native-ui.md',
              snippet: 'User expects Dreams to be a native ClawX interface, not only an external jump.',
              startLine: 4,
              totalSignalCount: 2,
            },
          ],
          promotedEntries: [],
        },
      },
    },
    [stableStringify(['doctor.memory.dreamDiary', {}])]: {
      success: true,
      result: {
        found: true,
        path: 'DREAMS.md',
        content: [
          '<!-- openclaw:dreaming:diary:start -->',
          '*2026-05-01*',
          'What Happened',
          '- Native dreams page landed [memory/dreams/native-ui.md]',
          '---',
          '*2026-04-30*',
          'Reflections',
          '- Older note',
          '<!-- openclaw:dreaming:diary:end -->',
        ].join('\n'),
      },
    },
    [stableStringify(['doctor.memory.backfillDreamDiary', {}])]: {
      success: true,
      result: { written: 2 },
    },
    [stableStringify(['doctor.memory.dedupeDreamDiary', {}])]: {
      success: true,
      result: { removedEntries: 2, keptEntries: 5 },
    },
    [stableStringify(['doctor.memory.resetDreamDiary', {}])]: {
      success: true,
      result: { removedEntries: 4 },
    },
    [stableStringify(['doctor.memory.resetGroundedShortTerm', {}])]: {
      success: true,
      result: { removedShortTermEntries: 3 },
    },
  };

  test('renders the native Dreams page and runs a maintenance action', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: dreamsRpcMocks,
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          },
        },
      },
    });

    await completeSetup(page);
    await enableDeveloperMode(page);
    await expect(page.getByTestId('sidebar-nav-dreams')).toBeVisible();
    await page.getByTestId('sidebar-nav-dreams').click();

    await expect(page.getByTestId('dreams-page')).toBeVisible();
    await expect(page.getByTestId('dreams-disable')).toBeVisible();
    await expect(page.getByText('Native dreams page landed')).toBeVisible();
    await expect(page.getByText('User expects Dreams to be a native ClawX interface')).toBeVisible();

    await page.getByTestId('dreams-action-backfill').click();
    await expect(page.getByTestId('dreams-action-message')).toContainText(/Backfilled 2 dream diary entries\.|已回填 2 条梦境日记。/);

    await page.getByTestId('dreams-action-dedupe').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('dreams-action-message')).toContainText(/Removed 2 duplicate dream entries and kept 5\.|已移除 2 条重复梦境，保留 5 条。/);

    await page.getByTestId('dreams-action-reset-grounded').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('dreams-action-message')).toContainText(/Cleared 3 replayed short-term entries\.|已清理 3 条回放短期记忆。/);

    await page.getByTestId('dreams-action-reset-diary').click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('dreams-action-message')).toContainText(/Removed 4 backfilled dream diary entries\.|已移除 4 条回填梦境日记。/);
  });

  test('starts Dreams from the native page when dreaming is disabled', async ({ electronApp, page }) => {
    const configHash = 'dreams-config-hash';
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        ...dreamsRpcMocks,
        [stableStringify(['doctor.memory.status', {}])]: {
          success: true,
          result: {
            dreaming: {
              enabled: false,
              timezone: 'Asia/Shanghai',
              storageMode: 'inline',
              shortTermCount: 0,
              groundedSignalCount: 0,
              totalSignalCount: 0,
              promotedToday: 0,
              phases: {
                light: { enabled: false },
                rem: { enabled: false },
                deep: { enabled: false },
              },
              shortTermEntries: [],
              promotedEntries: [],
            },
          },
        },
        [stableStringify(['config.get', {}])]: {
          success: true,
          result: { hash: configHash },
        },
        [stableStringify(['config.patch', {
          raw: buildDreamingEnabledPatchRaw(true),
          baseHash: configHash,
          note: 'Enable memory dreaming from ClawX Dreams.',
        }])]: {
          success: true,
          result: { ok: true },
        },
      },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          },
        },
      },
    });

    await completeSetup(page);
    await enableDeveloperMode(page);
    await page.getByTestId('sidebar-nav-dreams').click();

    await expect(page.getByTestId('dreams-page')).toBeVisible();
    await expect(page.getByTestId('dreams-enable')).toBeVisible();
    await page.getByTestId('dreams-enable').click();
    await expect(page.getByTestId('dreams-action-message')).toBeVisible();
    await expect(page.getByTestId('dreams-disable')).toBeVisible();
  });

  test('waits for the gateway process before loading Dreams data', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
      gatewayRpc: dreamsRpcMocks,
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'stopped', port: 18789 },
          },
        },
      },
    });

    await completeSetup(page);
    await enableDeveloperMode(page);
    await page.getByTestId('sidebar-nav-dreams').click();

    await expect(page.getByTestId('dreams-page')).toBeVisible();
    await expect(page.getByTestId('dreams-refresh')).toBeDisabled();
    await expect(page.getByTestId('dreams-enable')).toBeDisabled();
    await expect(page.getByTestId('dreams-action-backfill')).toBeDisabled();
    await expect(page.getByTestId('dreams-error')).toHaveCount(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 12345,
        gatewayReady: true,
        connectedAt: Date.now(),
      });
    });

    await expect(page.getByText('Native dreams page landed')).toBeVisible();
    await expect(page.getByTestId('dreams-action-backfill')).toBeEnabled();
  });
});
