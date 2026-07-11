import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { loadDefaultCcConnectLocalRealEnv } from './helpers/local-real-env';

loadDefaultCcConnectLocalRealEnv();

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

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPortClosed(port: number): Promise<void> {
  await expect.poll(async () => await isPortOpen(port), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `cc-connect port ${port} should be free before scheduled cron smoke starts`,
  }).toBe(false);
}

async function seedCcConnectRuntimeSettings(userDataDir: string): Promise<void> {
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
        baseUrl: 'http://127.0.0.1:11434/v1',
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
}

async function seedCcConnectOauthRuntimeSettings(userDataDir: string): Promise<void> {
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
      'openai-oauth': {
        id: 'openai-oauth',
        vendorId: 'openai',
        label: 'OpenAI Codex OAuth',
        authMode: 'oauth_browser',
        model: 'gpt-5.5',
        enabled: true,
        isDefault: true,
        metadata: { resourceUrl: 'openai-codex' },
        createdAt,
        updatedAt: createdAt,
      },
    },
    providerSecrets: {},
    apiKeys: {},
    defaultProviderAccountId: 'openai-oauth',
  }, null, 2), 'utf8');
}

async function copyLocalCodexAuthToManagedHome(userDataDir: string): Promise<string> {
  const source = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
  test.skip(!source, 'Set CLAWX_REAL_CODEX_AUTH_JSON to the auth.json that may be copied into the managed CODEX_HOME.');
  const managedCodexHome = join(userDataDir, 'runtimes', 'cc-connect', 'codex-home');
  await mkdir(managedCodexHome, { recursive: true });
  await copyFile(source, join(managedCodexHome, 'auth.json'));
  return source ?? '';
}

function scheduledMarkerCommand(markerPath: string): string {
  return [
    JSON.stringify(process.execPath),
    '-e',
    JSON.stringify("require('fs').writeFileSync(process.argv[1], 'CLAWX_SCHEDULED_EXEC_CRON_OK')"),
    JSON.stringify(markerPath),
  ].join(' ');
}

test.describe('cc-connect real scheduled cron delivery smoke', () => {
  test('delivers an enabled exec cron through the real cc-connect scheduler', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    test.skip(
      process.env.CLAWX_REAL_SCHEDULED_CRON_E2E !== '1',
      'Set CLAWX_REAL_SCHEDULED_CRON_E2E=1 to wait for the next real cron minute.',
    );
    test.setTimeout(180_000);

    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(userDataDir);
    const openClawConfigDir = join(homeDir, '.openclaw');
    const workspace = join(userDataDir, 'scheduled-cron-workspace');
    const markerPath = join(workspace, 'cc-connect-scheduled-exec-cron-marker.txt');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace },
        ],
      },
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });
    let cronId = '';

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-scheduled-cron',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      const createResult = await page.evaluate(async ({ command, workDir }) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-scheduled-exec',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real scheduled exec cron smoke',
            exec: command,
            workDir,
            sessionMode: 'new_per_run',
            timeoutMins: 1,
            schedule: { kind: 'cron', expr: '*/1 * * * *' },
            enabled: true,
            delivery: { mode: 'none' },
            agentId: 'main',
          },
        });
      }, { command: scheduledMarkerCommand(markerPath), workDir: workspace });
      expect(createResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real scheduled exec cron smoke',
          enabled: true,
          exec: expect.stringContaining('CLAWX_SCHEDULED_EXEC_CRON_OK'),
          workDir: workspace,
          timeoutMins: 1,
        }),
      });
      cronId = (createResult as { data?: { id?: string } }).data?.id ?? '';
      expect(cronId).toBeTruthy();

      await expect.poll(async () => (await readFile(markerPath, 'utf8').catch(() => '')).trim(), {
        timeout: 95_000,
        intervals: [1_000, 2_000, 5_000],
        message: 'enabled real cc-connect exec cron should fire on a real scheduler tick',
      }).toBe('CLAWX_SCHEDULED_EXEC_CRON_OK');

      const listResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-after-real-scheduled-exec',
          module: 'cron',
          action: 'list',
        });
      });
      expect(listResult).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: cronId,
            enabled: true,
            agentId: 'main',
          }),
        ]),
      });
    } finally {
      if (cronId) {
        const page = await getStableWindow(app).catch(() => null);
        await page?.evaluate(async (id) => {
          await window.clawx.hostInvoke({
            id: 'runtime-cron-delete-real-scheduled-exec-cleanup',
            module: 'cron',
            action: 'delete',
            payload: { id },
          });
        }, cronId).catch(() => undefined);
      }
      await closeElectronApp(app);
    }
  });

  test('delivers scheduled prompt cron through the ClawX cc-connect bridge fallback', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    test.skip(
      process.env.CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E !== '1',
      'Set CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E=1 with an explicit CLAWX_REAL_CODEX_AUTH_JSON to probe scheduled prompt delivery.',
    );
    test.setTimeout(240_000);

    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectOauthRuntimeSettings(userDataDir);
    const authSource = await copyLocalCodexAuthToManagedHome(userDataDir);
    await access(authSource);

    const openClawConfigDir = join(homeDir, '.openclaw');
    const workspace = join(userDataDir, 'scheduled-prompt-cron-workspace');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace },
        ],
      },
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });
    let cronId = '';

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-scheduled-prompt-cron',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      const createResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-scheduled-prompt',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real scheduled prompt cron smoke',
            message: 'Reply exactly: CLAWX_SCHEDULED_PROMPT_CRON_OK',
            sessionMode: 'new_per_run',
            timeoutMins: 2,
            schedule: { kind: 'cron', expr: '*/1 * * * *' },
            enabled: true,
            delivery: { mode: 'none' },
            agentId: 'main',
          },
        });
      });
      expect(createResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real scheduled prompt cron smoke',
          enabled: true,
          message: 'Reply exactly: CLAWX_SCHEDULED_PROMPT_CRON_OK',
          agentId: 'main',
        }),
      });
      cronId = (createResult as { data?: { id?: string } }).data?.id ?? '';
      expect(cronId).toBeTruthy();

      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-history-after-real-scheduled-prompt',
            module: 'sessions',
            action: 'history',
            payload: { sessionKey: 'agent:main:main', limit: 20 },
          });
        });
      }, {
        timeout: 150_000,
        intervals: [1_000, 2_000, 5_000, 10_000],
        message: 'enabled real cc-connect prompt cron should fire through the ClawX bridge on a real scheduler tick',
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_SCHEDULED_PROMPT_CRON_OK' }),
            expect.objectContaining({ role: 'assistant', content: expect.stringContaining('CLAWX_SCHEDULED_PROMPT_CRON_OK') }),
          ]),
        },
      });
    } finally {
      if (cronId) {
        const page = await getStableWindow(app).catch(() => null);
        await page?.evaluate(async (id) => {
          await window.clawx.hostInvoke({
            id: 'runtime-cron-delete-real-scheduled-prompt-cleanup',
            module: 'cron',
            action: 'delete',
            payload: { id },
          });
        }, cronId).catch(() => undefined);
      }
      await closeElectronApp(app);
    }
  });
});
