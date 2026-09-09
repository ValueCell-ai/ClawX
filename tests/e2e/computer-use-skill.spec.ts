import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function directoryContents(directory: string) {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort().map((entry) => {
    const path = join(directory, entry);
    return [entry, lstatSync(path).isDirectory() ? null : readFileSync(path)];
  });
}

for (const language of ['en', 'zh', 'ja', 'ru']) {
  test(`restores the managed computer-use skill and selects it without enabling desktop control (${language})`, async ({ launchElectronApp, homeDir }) => {
    const skills = join(homeDir, '.openclaw', 'skills');
    const target = join(skills, 'computer-use');
    const source = resolve('resources/skills/computer-use');
    const bundledContents = directoryContents(source);
    cpSync(source, target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), `${readFileSync(join(source, 'SKILL.md'), 'utf8')}\nLocal user edits.\n`);
    writeFileSync(join(target, 'local-notes.txt'), 'User-added file.\n');
    mkdirSync(join(target, 'local-extras'));
    writeFileSync(join(target, 'local-extras', 'notes.txt'), 'User-added directory content.\n');
    const custom = join(skills, 'custom-computer-use');
    mkdirSync(custom);
    writeFileSync(join(custom, 'SKILL.md'), '---\nname: custom-computer-use\ndescription: User-owned desktop instructions\n---\nKeep these custom instructions.\n');
    writeFileSync(join(custom, 'notes.txt'), 'Keep this custom file.\n');
    const customContents = directoryContents(custom);

    const app = await launchElectronApp({ skipSetup: true });
    try {
      // Retry across staged publication; compare every path and byte, including dotfiles.
      await expect(async () => {
        expect(directoryContents(target)).toEqual(bundledContents);
      }).toPass({ timeout: 15_000 });
      expect(existsSync(join(target, 'local-notes.txt'))).toBe(false);
      expect(existsSync(join(target, 'local-extras'))).toBe(false);
      expect(directoryContents(custom)).toEqual(customContents);
      const content = readFileSync(join(target, 'SKILL.md'), 'utf8');
      expect(content).toContain('official CUA 0.25.0');
      expect(content).not.toContain('0.21.0');
      expect(JSON.parse(readFileSync(join(target, 'UPSTREAM.json'), 'utf8'))).toMatchObject({
        version: '0.25.0', commit: '45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f',
      });
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
      expect(directoryContents(custom)).toEqual(customContents);
    } finally {
      await closeElectronApp(app);
    }
  });
}
