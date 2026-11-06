import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function configureModel(page: Page) {
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
}

test('adding an Agent preserves the inherited workspace of a legacy multi-Agent roster', async ({ launchElectronApp, homeDir }) => {
  const stateDir = join(homeDir, '.openclaw');
  const workspace = join(stateDir, 'workspace');
  const external = join(homeDir, '工程 Alpha');
  await mkdir(workspace, { recursive: true });
  await mkdir(external, { recursive: true });
  await writeFile(join(workspace, 'SOUL.md'), 'Existing main personality\n');
  await writeFile(join(external, 'keep.txt'), 'External workspace contents\n');
  await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify({ agents: {
    list: [{ id: 'main', name: 'Main' }, { id: 'coder', name: 'Coder', workspace: external }],
  } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await configureModel(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agent-card-coder')).toBeVisible();
    await page.getByTestId('agents-add-button').click();
    const dialog = page.getByTestId('add-agent-dialog');
    await dialog.locator('#agent-name').fill('Upgrade Workspace');
    await dialog.locator('#inherit-workspace').click();
    await dialog.getByRole('button', { name: 'Create assistant', exact: true }).click();
    await expect(page.getByTestId('agent-card-upgrade-workspace')).toBeVisible();
    const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
    expect(config.agents.list).toBeUndefined();
    expect(config.agents.entries.main.workspace).toBe(workspace);
    expect(config.agents.entries.coder.workspace).toBe(external);
    expect(await readFile(join(stateDir, 'workspace-upgrade-workspace', 'SOUL.md'), 'utf8')).toBe('Existing main personality\n');
    expect(await readFile(join(workspace, 'SOUL.md'), 'utf8')).toBe('Existing main personality\n');
    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('External workspace contents\n');
  } finally { await closeElectronApp(app); }
});

test('new Agent saves its model and instructions with a current SQLite auth store', async ({ launchElectronApp, homeDir }) => {
  const agentDir = join(homeDir, '.openclaw/agents/main/agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: {
    'review:default': { type: 'api_key', provider: 'review', key: 'synthetic-e2e-not-a-secret' },
  } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    const legacy = await page.evaluate(() => window.clawx.hostInvoke({
      id: 'create-legacy-agent',
      module: 'agents',
      action: 'create',
      payload: { name: 'Legacy Agent' },
    }));
    expect(legacy).toMatchObject({ ok: true, data: { success: true } });
    await configureModel(page);
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
      return { created: readAuth('upgrade-agent'), legacy: readAuth('legacy-agent'), main: readAuth('main') };
    }, homeDir);
    expect(persisted.created.version).toBe(25);
    expect(persisted.created.integrity).toBe('ok');
    expect(persisted.created.store.profiles['moonshot:default'].key).toBe('synthetic-e2e-provider-key');
    expect(persisted.legacy.version).toBe(25);
    expect(persisted.legacy.integrity).toBe('ok');
    expect(persisted.legacy.store.profiles['review:default'].key).toBe('synthetic-e2e-not-a-secret');
    expect(persisted.main.store.profiles['review:default'].key).toBe('synthetic-e2e-not-a-secret');
  } finally { await closeElectronApp(app); }
});

test('deleting an Agent keeps a managed workspace still used by the main Agent', async ({ launchElectronApp, homeDir }) => {
  const stateDir = join(homeDir, '.openclaw');
  const sharedWorkspace = join(stateDir, 'workspace-coder');
  await mkdir(sharedWorkspace, { recursive: true });
  await writeFile(join(sharedWorkspace, 'keep.txt'), 'Still used by main\n');
  await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify({ agents: {
    ownership: 'explicit', defaults: { systemAgent: { agentId: 'main' } },
    entries: { main: { workspace: sharedWorkspace }, coder: { name: 'Coder' } },
  } }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-agents').click();
    const card = page.getByTestId('agent-card-coder');
    await expect(card).toBeVisible();
    await page.getByTestId('agent-menu-coder').click();
    await page.getByTestId('agent-delete-coder').click();
    await page.getByTestId('confirm-dialog-confirm-button').click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('agent-card-main')).toBeVisible();
    expect(await readFile(join(sharedWorkspace, 'keep.txt'), 'utf8')).toBe('Still used by main\n');
    const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
    expect(config.agents.entries.main.workspace).toBe(sharedWorkspace);
    expect(config.agents.entries.coder).toBeUndefined();
  } finally { await closeElectronApp(app); }
});
