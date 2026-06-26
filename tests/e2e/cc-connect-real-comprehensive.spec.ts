import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
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
    message: `cc-connect port ${port} should be free before real comprehensive smoke starts`,
  }).toBe(false);
}

async function copyLocalCodexAuthToManagedHome(userDataDir: string): Promise<string> {
  const source = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim() || join(homedir(), '.codex', 'auth.json');
  const managedCodexHome = join(userDataDir, 'runtimes', 'cc-connect', 'codex-home');
  await mkdir(managedCodexHome, { recursive: true });
  await copyFile(source, join(managedCodexHome, 'auth.json'));
  return source;
}

test.describe('cc-connect real comprehensive runtime smoke', () => {
  test('validates chat, sessions, project workspace, skills, and cron through real cc-connect + Codex OAuth', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    test.skip(process.env.CLAWX_REAL_OAUTH_E2E !== '1', 'Set CLAWX_REAL_OAUTH_E2E=1 with a logged-in Codex auth.json.');
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const authSource = await copyLocalCodexAuthToManagedHome(userDataDir);
    await access(authSource);

    const skillDir = join(homeDir, '.agents', 'skills', 'real-smoke-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: real-smoke-skill',
      'description: Real cc-connect smoke skill.',
      '---',
      'Use this skill only as a local sync sentinel.',
      '',
    ].join('\n'), 'utf8');

    const createdAt = new Date().toISOString();
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

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-comprehensive',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill('Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText('CLAWX_REAL_COMPREHENSIVE_CHAT_OK')).toBeVisible({ timeout: 180_000 });

      const sessionsResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-sessions-real-comprehensive',
          module: 'sessions',
          action: 'summaries',
          payload: {},
        });
      });
      expect(sessionsResult).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({ key: 'agent:main:main' }),
          ]),
        },
      });

      const readHistory = async () => await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-history-real-comprehensive',
          module: 'sessions',
          action: 'history',
          payload: { sessionKey: 'agent:main:main', limit: 20 },
        });
      });
      await expect.poll(readHistory, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      const restartResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-restart-real-comprehensive',
          module: 'gateway',
          action: 'restart',
        });
      });
      expect(restartResult).toMatchObject({ ok: true, data: { success: true } });
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await expect.poll(readHistory, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CHAT_OK' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
      const mainWorkspace = join(runtimeDir, 'workspaces', 'main');
      await access(mainWorkspace);
      const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
      expect(managedConfig).toContain(`work_dir = "${mainWorkspace}"`);
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());

      const skillsStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-skills-real-comprehensive',
          module: 'skills',
          action: 'status',
        });
      });
      expect(skillsStatus).toMatchObject({
        ok: true,
        data: {
          skills: expect.arrayContaining([
            expect.objectContaining({ skillKey: 'real-smoke-skill' }),
          ]),
        },
      });
      await expect(readFile(join(runtimeDir, 'codex-home', 'skills', 'real-smoke-skill', 'SKILL.md'), 'utf8'))
        .resolves.toContain('Real cc-connect smoke skill');
      await expect(readFile(join(runtimeDir, 'codex-home', 'skills', 'manifest.json'), 'utf8'))
        .resolves.toContain('real-smoke-skill');

      const cronCreate = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-comprehensive',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real cc-connect smoke cron',
            message: 'Reply exactly: CLAWX_REAL_COMPREHENSIVE_CRON_OK',
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
          },
        });
      });
      expect(cronCreate).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real cc-connect smoke cron',
          enabled: true,
        }),
      });
      const cronId = (cronCreate as { data?: { id?: string } }).data?.id;
      expect(cronId).toBeTruthy();

      const cronList = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-real-comprehensive',
          module: 'cron',
          action: 'list',
        });
      });
      expect(cronList).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: cronId }),
        ]),
      });

      const cronRun = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-run-real-comprehensive',
          module: 'cron',
          action: 'trigger',
          payload: { id },
        });
      }, cronId);
      if (!cronRun.ok) {
        throw new Error(`cron trigger failed: ${JSON.stringify(cronRun)}`);
      }
      expect(cronRun).toMatchObject({ ok: true, data: { success: true } });

      const cronToggle = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-toggle-real-comprehensive',
          module: 'cron',
          action: 'toggle',
          payload: { id, enabled: false },
        });
      }, cronId);
      expect(cronToggle).toMatchObject({
        ok: true,
        data: expect.objectContaining({ id: cronId, enabled: false }),
      });

      const cronDelete = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete-real-comprehensive',
          module: 'cron',
          action: 'delete',
          payload: { id },
        });
      }, cronId);
      expect(cronDelete).toMatchObject({ ok: true, data: { success: true } });

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain('access_token');
      expect(publicProfile).not.toContain('refresh_token');
      expect(publicProfile).not.toContain('id_token');

      const deleteSession = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-session-delete-real-comprehensive',
          module: 'sessions',
          action: 'delete',
          payload: { sessionKey: 'agent:main:main' },
        });
      });
      expect(deleteSession).toMatchObject({ ok: true, data: { success: true } });

      await expect.poll(async () => {
        const [sessionsAfterDelete, historyAfterDelete] = await Promise.all([
          page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-sessions-after-delete-real-comprehensive',
              module: 'sessions',
              action: 'summaries',
              payload: {},
            });
          }),
          page.evaluate(async () => {
            return await window.clawx.hostInvoke({
              id: 'runtime-history-after-delete-real-comprehensive',
              module: 'sessions',
              action: 'history',
              payload: { sessionKey: 'agent:main:main', limit: 20 },
            });
          }),
        ]);
        const sessions = (sessionsAfterDelete as { data?: { sessions?: Array<{ key?: string }> } }).data?.sessions ?? [];
        const messages = (historyAfterDelete as { data?: { messages?: unknown[] } }).data?.messages ?? [];
        return {
          sessionRemoved: !sessions.some((session) => session.key === 'agent:main:main'),
          historyEmpty: messages.length === 0,
        };
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual({ sessionRemoved: true, historyEmpty: true });
    } finally {
      await closeElectronApp(app);
    }
  });
});
