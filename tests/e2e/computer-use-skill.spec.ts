import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test('selects the locally bundled computer-use skill without enabling desktop control', async ({ launchElectronApp, homeDir }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const manifestPath = join(homeDir, '.openclaw', 'skills', 'computer-use', 'SKILL.md');
    await expect.poll(() => existsSync(manifestPath)).toBe(true);
    expect(readFileSync(manifestPath, 'utf8')).toBe(readFileSync(resolve('resources/skills/computer-use/SKILL.md'), 'utf8'));

    // Keep Chat available without a provider. Skill discovery and Computer Use status remain real.
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpc: {
        '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } },
      },
      recordHostInvocations: true,
    });
    const page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
    const status = () => page.evaluate(() => window.clawx.hostInvoke({
      id: 'skill-computer-status', module: 'computerUse', action: 'status',
    }));
    expect(await status()).toMatchObject({ ok: true, data: { enabled: false, running: false } });
    await expect(page.getByTestId('chat-composer-skill-token')).toHaveCount(0);
    await page.getByTestId('chat-composer-input').fill('Inspect the desktop ');
    await page.getByTestId('chat-composer-skill').click();
    await page.getByText('/computer-use', { exact: true }).click();
    await expect(page.getByTestId('chat-composer-skill-token')).toHaveText('/computer-use');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue(/\/computer-use/);
    expect(await status()).toMatchObject({ ok: true, data: { enabled: false, running: false } });
    const calls = await app.evaluate(() => (globalThis as unknown as {
      __e2eHostInvocations: Array<{ module: string; action: string }>;
    }).__e2eHostInvocations);
    expect(calls).toEqual(expect.arrayContaining([{ module: 'skills', action: 'quickAccess', payload: expect.anything() }]));
    expect(calls.filter((call) => call.module === 'computerUse').map((call) => call.action)).toEqual(['status', 'status']);
    expect(calls.some((call) => call.module === 'chat' && call.action === 'send')).toBe(false);
  } finally {
    await closeElectronApp(app);
  }
});
