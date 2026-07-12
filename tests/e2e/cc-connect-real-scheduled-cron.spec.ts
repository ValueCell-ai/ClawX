import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { loadDefaultCcConnectLocalRealEnv } from './helpers/local-real-env';
import type { Page } from '@playwright/test';

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
  const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
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

function nextSafeMinuteCronExpression(now = new Date()): string {
  const target = new Date(now);
  target.setMilliseconds(0);
  target.setSeconds(0);
  target.setMinutes(target.getMinutes() + (now.getSeconds() >= 45 ? 2 : 1));
  return `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
}

async function findPromptCronHistory(page: Page, marker: string): Promise<{
  found: boolean;
  matchingSessionKeys: string[];
}> {
  const summaries = await page.evaluate(async () => window.clawx.hostInvoke({
    id: `runtime-scheduled-prompt-summaries-${Date.now()}`,
    module: 'sessions',
    action: 'summaries',
    payload: {},
  })) as { ok?: boolean; data?: { sessions?: Array<{ key?: string }> } };
  const sessionKeys = (summaries.data?.sessions ?? [])
    .map((session) => session.key)
    .filter((key): key is string => Boolean(key));
  const matchingSessionKeys: string[] = [];
  for (const sessionKey of sessionKeys) {
    const history = await page.evaluate(async (key) => window.clawx.hostInvoke({
      id: `runtime-scheduled-prompt-history-${Date.now()}`,
      module: 'sessions',
      action: 'history',
      payload: { sessionKey: key, limit: 200 },
    }), sessionKey) as {
      ok?: boolean;
      data?: { success?: boolean; messages?: Array<{ role?: string; content?: unknown }> };
    };
    const messages = history.data?.messages ?? [];
    const hasPrompt = messages.some((message) => (
      message.role === 'user' && JSON.stringify(message.content).includes(marker)
    ));
    const hasReply = messages.some((message) => (
      message.role === 'assistant' && JSON.stringify(message.content).includes(marker)
    ));
    if (history.ok && history.data?.success && hasPrompt && hasReply) {
      matchingSessionKeys.push(sessionKey);
    }
  }
  return { found: matchingSessionKeys.length > 0, matchingSessionKeys };
}

async function collectPromptCronDiagnostics(page: Page, cronId: string) {
  return await page.evaluate(async (id) => {
    const [cronList, health, snapshot, sessions] = await Promise.all([
      window.clawx.hostInvoke({
        id: `runtime-scheduled-prompt-cron-list-${Date.now()}`,
        module: 'gateway',
        action: 'rpc',
        payload: { method: 'cron.list' },
      }),
      window.clawx.hostInvoke({
        id: `runtime-scheduled-prompt-health-${Date.now()}`,
        module: 'gateway',
        action: 'health',
        payload: { probe: true },
      }),
      window.clawx.hostInvoke({
        id: `runtime-scheduled-prompt-diagnostics-${Date.now()}`,
        module: 'diagnostics',
        action: 'gatewaySnapshot',
      }),
      window.clawx.hostInvoke({
        id: `runtime-scheduled-prompt-session-list-${Date.now()}`,
        module: 'sessions',
        action: 'summaries',
        payload: {},
      }),
    ]);
    const jobs = Array.isArray(cronList.data) ? cronList.data : [];
    const sessionRows = sessions.data && typeof sessions.data === 'object'
      && Array.isArray((sessions.data as { sessions?: unknown[] }).sessions)
      ? (sessions.data as { sessions: unknown[] }).sessions
      : [];
    const runtime = snapshot.data && typeof snapshot.data === 'object'
      ? (snapshot.data as { runtime?: { ccConnect?: { logTail?: string } } }).runtime
      : undefined;
    return {
      job: jobs.find((job) => job && typeof job === 'object' && (job as { id?: string }).id === id) ?? null,
      health,
      sessionRows,
      logTail: runtime?.ccConnect?.logTail?.slice(-4_000) ?? '',
    };
  }, cronId);
}

async function deleteCronAndVerify(page: Page, cronId: string, requestId: string): Promise<void> {
  const deleteResult = await page.evaluate(async ({ id, requestId: deleteRequestId }) => {
    return await window.clawx.hostInvoke({
      id: deleteRequestId,
      module: 'cron',
      action: 'delete',
      payload: { id },
    });
  }, { id: cronId, requestId });
  expect(deleteResult).toMatchObject({ ok: true, data: { success: true } });

  await expect.poll(async () => {
    const listResult = await page.evaluate(async () => window.clawx.hostInvoke({
      id: `runtime-cron-list-after-scheduled-cleanup-${Date.now()}`,
      module: 'cron',
      action: 'list',
    })) as { ok?: boolean; data?: Array<{ id?: string }> };
    expect(listResult.ok).toBe(true);
    return (listResult.data ?? []).some((job) => job.id === cronId);
  }, {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `scheduled cron ${cronId} should be absent after deletion`,
  }).toBe(false);
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
      const statusBefore = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-status-before-real-scheduled-exec',
        module: 'gateway',
        action: 'status',
      })) as { ok?: boolean; data?: { pid?: number; runtimeKind?: string } };
      expect(statusBefore).toMatchObject({ ok: true, data: { runtimeKind: 'cc-connect', pid: expect.any(Number) } });

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

      const statusAfter = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-status-after-real-scheduled-exec',
        module: 'gateway',
        action: 'status',
      })) as { ok?: boolean; data?: { pid?: number; runtimeKind?: string } };
      expect(statusAfter.data?.pid).toBe(statusBefore.data?.pid);

      await page.getByTestId('sidebar-nav-cron').click();
      await expect(page.getByTestId('cron-page')).toBeVisible();
      const jobCard = page.getByTestId(`cron-job-card-${cronId}`);
      await expect(jobCard).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`cron-job-card-title-${cronId}`)).toHaveText('Real scheduled exec cron smoke');
      await jobCard.scrollIntoViewIfNeeded();
      const commandLine = jobCard.locator('p').filter({ hasText: process.execPath });
      await expect(commandLine).toBeVisible();
      const evidenceDir = join(process.cwd(), 'artifacts', 'cc-connect');
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(evidenceDir, 'real-scheduled-exec-cron.png'),
        fullPage: false,
        mask: [commandLine],
        maskColor: '#e5e7eb',
      });
      await deleteCronAndVerify(page, cronId, 'runtime-cron-delete-real-scheduled-exec');
      cronId = '';
      await writeFile(join(evidenceDir, 'real-scheduled-exec-cron.json'), `${JSON.stringify({
        schema: 'clawx-cc-connect-real-scheduled-exec-cron-evidence',
        version: 1,
        runtimeKind: 'cc-connect',
        runtimeBinary: 'real-bundled-v1.4.1',
        schedulerTickObserved: true,
        marker: 'CLAWX_SCHEDULED_EXEC_CRON_OK',
        markerWrittenInConfiguredWorkspace: true,
        jobListedThroughHostApi: true,
        runtimePidPreserved: statusAfter.data?.pid === statusBefore.data?.pid,
        scheduledJobCleanupObserved: true,
        screenshot: 'artifacts/cc-connect/real-scheduled-exec-cron.png',
      }, null, 2)}\n`, 'utf8');
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

  test('delivers scheduled prompt cron through the cc-connect runtime', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }, testInfo) => {
    test.skip(
      process.env.CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E !== '1',
      'Set CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E=1 with an explicit CLAWX_REAL_CODEX_AUTH_JSON to probe scheduled prompt delivery.',
    );
    test.setTimeout(300_000);

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
      const statusBefore = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-status-before-real-scheduled-prompt',
        module: 'gateway',
        action: 'status',
      })) as { ok?: boolean; data?: { pid?: number; runtimeKind?: string } };
      expect(statusBefore).toMatchObject({ ok: true, data: { runtimeKind: 'cc-connect', pid: expect.any(Number) } });

      const promptCronExpression = nextSafeMinuteCronExpression();
      const createResult = await page.evaluate(async (cronExpression) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-scheduled-prompt',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real scheduled prompt cron smoke',
            message: 'Reply exactly: CLAWX_SCHEDULED_PROMPT_CRON_OK',
            sessionMode: 'new_per_run',
            timeoutMins: 2,
            schedule: { kind: 'cron', expr: cronExpression },
            enabled: true,
            delivery: { mode: 'none' },
            agentId: 'main',
          },
        });
      }, promptCronExpression);
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

      try {
        await expect.poll(async () => await findPromptCronHistory(page, 'CLAWX_SCHEDULED_PROMPT_CRON_OK'), {
          timeout: 225_000,
          intervals: [1_000, 2_000, 5_000, 10_000],
          message: 'enabled real cc-connect prompt cron should fire into a public runtime session on a scheduler tick',
        }).toMatchObject({ found: true, matchingSessionKeys: expect.any(Array) });
      } catch (error) {
        const diagnostics = await collectPromptCronDiagnostics(page, cronId);
        await testInfo.attach('scheduled-prompt-diagnostics', {
          body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
          contentType: 'application/json',
        });
        throw new Error(
          `Scheduled prompt cron did not produce a public reply. Diagnostics: ${JSON.stringify(diagnostics)}`,
          { cause: error },
        );
      }

      const promptHistory = await findPromptCronHistory(page, 'CLAWX_SCHEDULED_PROMPT_CRON_OK');
      expect(promptHistory).toMatchObject({ found: true, matchingSessionKeys: expect.any(Array) });
      const statusAfter = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-status-after-real-scheduled-prompt',
        module: 'gateway',
        action: 'status',
      })) as { ok?: boolean; data?: { pid?: number; runtimeKind?: string } };
      expect(statusAfter.data?.pid).toBe(statusBefore.data?.pid);

      await page.getByTestId('sidebar-nav-cron').click();
      await expect(page.getByTestId('cron-page')).toBeVisible();
      const jobCard = page.getByTestId(`cron-job-card-${cronId}`);
      await expect(jobCard).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`cron-job-card-title-${cronId}`)).toHaveText('Real scheduled prompt cron smoke');
      await jobCard.scrollIntoViewIfNeeded();
      const evidenceDir = join(process.cwd(), 'artifacts', 'cc-connect');
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(evidenceDir, 'real-scheduled-prompt-cron.png'),
        fullPage: false,
      });
      await deleteCronAndVerify(page, cronId, 'runtime-cron-delete-real-scheduled-prompt');
      cronId = '';
      await writeFile(join(evidenceDir, 'real-scheduled-prompt-cron.json'), `${JSON.stringify({
        schema: 'clawx-cc-connect-real-scheduled-prompt-cron-evidence',
        version: 1,
        runtimeKind: 'cc-connect',
        runtimeBinary: 'real-bundled-v1.4.1',
        schedulerTickObserved: true,
        promptMarker: 'CLAWX_SCHEDULED_PROMPT_CRON_OK',
        publicSessionHistoryObserved: promptHistory.found,
        matchingSessionKeys: promptHistory.matchingSessionKeys,
        codexReachedOnlyThroughCcConnect: true,
        runtimePidPreserved: statusAfter.data?.pid === statusBefore.data?.pid,
        scheduledJobCleanupObserved: true,
        screenshot: 'artifacts/cc-connect/real-scheduled-prompt-cron.png',
      }, null, 2)}\n`, 'utf8');
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
