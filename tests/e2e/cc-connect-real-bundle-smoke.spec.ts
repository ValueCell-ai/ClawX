import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function realRuntimeBundles(): Promise<{ ccConnectPath: string; codexPath: string } | null> {
  const platformArch = `${process.platform}-${process.arch}`;
  const ccConnectPath = join(
    process.cwd(),
    'build',
    'cc-connect',
    platformArch,
    process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect',
  );
  const codexPath = join(
    process.cwd(),
    'build',
    'codex',
    platformArch,
    'bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  );
  try {
    await access(ccConnectPath);
    await access(codexPath);
    return { ccConnectPath, codexPath };
  } catch {
    return null;
  }
}

test.describe('cc-connect real runtime bundle smoke', () => {
  test('starts cc-connect from bundled binaries in a local dev Electron run', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');

    const createdAt = '2026-06-07T00:00:00.000Z';
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'ollama-local': {
          id: 'ollama-local',
          vendorId: 'ollama',
          label: 'Ollama',
          authMode: 'local',
          model: 'qwen3:latest',
          enabled: true,
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: 'ollama-local',
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CODEX_WORKDIR: process.cwd(),
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const statusResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-real-bundle',
          module: 'gateway',
          action: 'status',
        });
      });
      expect(statusResult).toMatchObject({
        ok: true,
        data: {
          runtimeKind: 'cc-connect',
        },
      });

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('Managed by ClawX');
      expect(managedConfig).toContain('BridgePlatform');
      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('"vendorId": "ollama"');
      expect(publicProfile).toContain('qwen3:latest');
    } finally {
      await closeElectronApp(app);
    }
  });
});
