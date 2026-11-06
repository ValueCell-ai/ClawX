import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('new Agent saves its model and instructions with a current SQLite auth store', async ({ launchElectronApp, homeDir }) => {
  const agentDir = join(homeDir, '.openclaw/agents/main/agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: {
    'review:default': { type: 'api_key', provider: 'review', key: 'synthetic-e2e-not-a-secret' },
  } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    const savedProvider = await page.evaluate(() => {
      const now = new Date().toISOString();
      return window.electron.ipcRenderer.invoke('provider:save', {
        id: 'moonshot-upgrade-e2e',
        name: 'Moonshot E2E',
        type: 'moonshot',
        model: 'kimi-k2.6',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }, 'synthetic-e2e-provider-key');
    });
    expect(savedProvider).toMatchObject({ success: true });
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('agents-add-button').click();
    const dialog = page.getByTestId('add-agent-dialog');
    await dialog.locator('#agent-name').fill('Upgrade Agent');
    const instructions = 'Check the upgraded agent workspace.';
    await dialog.getByTestId('agent-create-instructions').fill(instructions);
    await expect(dialog.getByTestId('agent-create-model-picker-button')).toHaveText('kimi-k2.6');
    await dialog.getByRole('button', { name: 'Create assistant', exact: true }).click();
    await expect(page.getByTestId('agent-card-upgrade-agent')).toBeVisible();
    const config = JSON.parse(await readFile(join(homeDir, '.openclaw/openclaw.json'), 'utf8'));
    expect(config.agents.entries['upgrade-agent'].model.primary).toBe('moonshot/kimi-k2.6');
    expect(await readFile(join(homeDir, '.openclaw/workspace-upgrade-agent/SOUL.md'), 'utf8')).toBe(`${instructions}\n`);
    const persisted = await app.evaluate((_electron, home) => {
      const { DatabaseSync } = process.mainModule!.require('node:sqlite');
      const readAuth = (id: string) => {
        const db = new DatabaseSync(`${home}/.openclaw/agents/${id}/agent/openclaw-agent.sqlite`, { readOnly: true });
        try {
          return {
            version: db.prepare('PRAGMA user_version').get().user_version,
            store: JSON.parse(db.prepare("SELECT store_json FROM auth_profile_store WHERE store_key='primary'").get().store_json),
            integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
          };
        } finally { db.close(); }
      };
      return { created: readAuth('upgrade-agent'), main: readAuth('main') };
    }, homeDir);
    expect(persisted.created.version).toBe(25);
    expect(persisted.created.integrity).toBe('ok');
    expect(persisted.created.store.profiles['moonshot:default'].key).toBe('synthetic-e2e-provider-key');
    expect(persisted.main.store.profiles['review:default'].key).toBe('synthetic-e2e-not-a-secret');
  } finally { await closeElectronApp(app); }
});
