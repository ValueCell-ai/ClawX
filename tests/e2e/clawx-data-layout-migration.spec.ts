import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('ClawX canonical data layout migration', () => {
  test('boots Electron on the shared root and imports legacy app state without deleting it', async ({
    launchElectronApp,
    homeDir,
    userDataDir: dataRoot,
  }) => {
    const legacyDir = join(homeDir, 'legacy-electron-user-data');
    const legacySettingsPath = join(legacyDir, 'settings.json');
    const legacyProvidersPath = join(legacyDir, 'clawx-providers.json');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(legacySettingsPath, JSON.stringify({
      language: 'en',
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
      devModeUnlocked: true,
    }, null, 2), 'utf8');
    await writeFile(legacyProvidersPath, JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'legacy-openai-oauth': {
          id: 'legacy-openai-oauth',
          vendorId: 'openai',
          label: 'Legacy OpenAI OAuth',
          authMode: 'oauth_browser',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: 'legacy-openai-oauth',
    }, null, 2), 'utf8');

    const launchOptions = {
      skipSetup: true,
      omitUserDataOverride: true,
      initialUserDataDir: legacyDir,
      env: { CLAWX_DATA_HOME: dataRoot },
    } as const;
    const app = await launchElectronApp(launchOptions);

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const electronUserData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
      expect(electronUserData).toBe(join(dataRoot, 'system', 'electron'));

      const [settings, providers, versionFile, migrationJournal] = await Promise.all([
        readFile(join(dataRoot, 'app', 'settings.json'), 'utf8'),
        readFile(join(dataRoot, 'app', 'clawx-providers.json'), 'utf8'),
        readFile(join(dataRoot, 'state', 'data-version.json'), 'utf8'),
        readFile(join(dataRoot, 'state', 'migration-journal.jsonl'), 'utf8'),
      ]);
      expect(JSON.parse(settings)).toMatchObject({ runtimeKind: 'cc-connect', gatewayAutoStart: false });
      expect(JSON.parse(providers)).toMatchObject({
        providerAccounts: {
          'legacy-openai-oauth': expect.objectContaining({ authMode: 'oauth_browser' }),
        },
      });
      expect(JSON.parse(versionFile)).toMatchObject({ schema: 'clawx-data', version: 1 });
      const migrationRecord = JSON.parse(migrationJournal.trim().split('\n')[0]);
      expect(migrationRecord).toMatchObject({ migration: 'legacy-electron-user-data-import' });
      expect(migrationRecord.source).toBe(await realpath(legacyDir));
      expect(migrationJournal).toContain('settings.json');
      expect(migrationJournal).toContain('clawx-providers.json');

      await expect(access(legacySettingsPath)).resolves.toBeUndefined();
      await expect(access(legacyProvidersPath)).resolves.toBeUndefined();
    } finally {
      await closeElectronApp(app);
    }

    await writeFile(legacySettingsPath, JSON.stringify({
      language: 'en',
      runtimeKind: 'openclaw',
      gatewayAutoStart: true,
    }, null, 2), 'utf8');
    const relaunchedApp = await launchElectronApp(launchOptions);
    try {
      const page = await getStableWindow(relaunchedApp);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const canonicalSettings = JSON.parse(await readFile(join(dataRoot, 'app', 'settings.json'), 'utf8'));
      expect(canonicalSettings).toMatchObject({ runtimeKind: 'cc-connect', gatewayAutoStart: false });
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
