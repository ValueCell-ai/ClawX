import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

for (const language of ['en', 'zh', 'ja', 'ru']) {
  test(`selects the bundled CLI computer-use skill without enabling desktop control (${language})`, async ({ launchElectronApp, homeDir }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const target = join(homeDir, '.openclaw', 'skills', 'computer-use');
      const source = resolve('resources/skills/computer-use');
      const files = readdirSync(source).filter((file) => file.endsWith('.md') || file === 'UPSTREAM.json');
      // Wait for the entire directory copy, not just the first manifest write.
      await expect.poll(() => files.every((file) => existsSync(join(target, file))
        && readFileSync(join(target, file)).equals(readFileSync(join(source, file))))).toBe(true);
      const content = readFileSync(join(target, 'SKILL.md'), 'utf8');
      expect(content).toContain('official CUA 0.21.0');
      expect(content).toContain('CLAWX_CUA_CONNECTION_FILE');
      expect(content).toContain('--socket');
      expect(content).not.toContain('Use only the available `computer` tool');
      for (const [, reference] of content.matchAll(/\]\(([^):]+\.md)\)/g)) {
        expect(existsSync(resolve(target, reference))).toBe(true);
      }

      // Keep Chat available without a provider. Skill discovery and Computer Use status remain real.
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpc: {
          '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } },
        },
        recordHostInvocations: true,
        hostApi: {
          [JSON.stringify(['/api/settings', 'GET'])]: {
            ok: true, data: { status: 200, ok: true, json: { language, setupComplete: true } },
          },
        },
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
      await expect(page.getByText('/cua-driver', { exact: true })).toHaveCount(0);
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
}
