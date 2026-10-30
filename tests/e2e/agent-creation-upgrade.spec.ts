import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('new Agent publishes a current SQLite auth store with inherited credentials', async ({ launchElectronApp, homeDir }) => {
  const agentDir = join(homeDir, '.openclaw/agents/main/agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: {
    'review:default': { type: 'api_key', provider: 'review', key: 'synthetic-e2e-not-a-secret' },
  } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('agents-add-button').click();
    const dialog = page.getByTestId('add-agent-dialog');
    await dialog.locator('#agent-name').fill('Upgrade Agent');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('agent-card-upgrade-agent')).toBeVisible();
    const persisted = await app.evaluate(async (_electron, home) => {
      const { DatabaseSync } = process.mainModule!.require('node:sqlite');
      const db = new DatabaseSync(`${home}/.openclaw/agents/upgrade-agent/agent/openclaw-agent.sqlite`, { readOnly: true });
      try {
        return { version: db.prepare('PRAGMA user_version').get().user_version,
          store: JSON.parse(db.prepare("SELECT store_json FROM auth_profile_store WHERE store_key='primary'").get().store_json),
          integrity: db.prepare('PRAGMA integrity_check').get().integrity_check };
      } finally { db.close(); }
    }, homeDir);
    expect(persisted.version).toBe(25);
    expect(persisted.integrity).toBe('ok');
    expect(persisted.store.profiles['review:default'].key).toBe('synthetic-e2e-not-a-secret');
  } finally { await closeElectronApp(app); }
});
