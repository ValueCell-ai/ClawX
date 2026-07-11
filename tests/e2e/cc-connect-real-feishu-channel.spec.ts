import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { loadDefaultCcConnectLocalRealEnv } from './helpers/local-real-env';
import { writeFeishuInboundMarkerArtifact } from './helpers/feishu-inbound-marker';
import type { Page } from '@playwright/test';

const execFileAsync = promisify(execFile);

loadDefaultCcConnectLocalRealEnv();

type RuntimeBundles = {
  ccConnectPath: string;
  codexPath: string;
};

async function realRuntimeBundles(): Promise<RuntimeBundles | null> {
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
    message: `cc-connect port ${port} should be free before real Feishu channel smoke starts`,
  }).toBe(false);
}

async function listProcessCommandsContaining(needle: string): Promise<string[]> {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(needle))
    .filter((line) => !line.includes('ps -axo'));
}

async function waitForNoRuntimeProcesses(runtimeDir: string): Promise<void> {
  if (process.platform === 'win32') return;
  await expect.poll(async () => await listProcessCommandsContaining(runtimeDir), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `no real Feishu runtime process should reference ${runtimeDir}`,
  }).toEqual([]);
}

async function findMarkerThroughHostApi(page: Page, marker: string): Promise<{
  found: boolean;
  matchingSessionKeys: string[];
}> {
  const summaries = await page.evaluate(async () => window.clawx.hostInvoke({
    id: `runtime-feishu-inbound-summaries-${Date.now()}`,
    module: 'sessions',
    action: 'summaries',
    payload: {},
  })) as { ok?: boolean; data?: { sessions?: Array<{ key?: string }> } };
  if (!summaries.ok) return { found: false, matchingSessionKeys: [] };

  const sessionKeys = (summaries.data?.sessions ?? [])
    .map((session) => session.key)
    .filter((key): key is string => Boolean(key));
  const matchingSessionKeys: string[] = [];
  for (const sessionKey of sessionKeys) {
    const history = await page.evaluate(async (key) => window.clawx.hostInvoke({
      id: `runtime-feishu-inbound-history-${Date.now()}`,
      module: 'sessions',
      action: 'history',
      payload: { sessionKey: key, limit: 200 },
    }), sessionKey) as { ok?: boolean; data?: { success?: boolean; messages?: unknown[] } };
    if (history.ok && history.data?.success && JSON.stringify(history.data.messages ?? []).includes(marker)) {
      matchingSessionKeys.push(sessionKey);
    }
  }
  return { found: matchingSessionKeys.length > 0, matchingSessionKeys };
}

async function copyLocalCodexAuthToManagedHome(userDataDir: string): Promise<string> {
  const source = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
  test.skip(!source, 'Set CLAWX_REAL_CODEX_AUTH_JSON to the auth.json that may be copied into the managed CODEX_HOME.');
  const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
  await mkdir(managedCodexHome, { recursive: true });
  await copyFile(source, join(managedCodexHome, 'auth.json'));
  return source ?? '';
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  test.skip(!value, `Set ${name} for the real cc-connect Feishu channel smoke.`);
  return value ?? '';
}

function feishuDomainInput(): string {
  const value = process.env.CLAWX_REAL_FEISHU_DOMAIN?.trim();
  if (!value) return 'feishu';
  if (value === 'cn') return 'feishu';
  if (value === 'global') return 'lark';
  return value;
}

function expectedPlatformType(domain: string): 'feishu' | 'lark' {
  const normalized = domain.toLowerCase();
  return normalized === 'lark' || normalized.includes('larksuite.com') ? 'lark' : 'feishu';
}

function expectedDomainUrl(domain: string, platformType: 'feishu' | 'lark'): string {
  const normalized = domain.toLowerCase();
  if (normalized === 'lark') return 'https://open.larksuite.com';
  if (normalized === 'feishu') return 'https://open.feishu.cn';
  if (platformType === 'lark' && !domain.includes('larksuite.com')) return 'https://open.larksuite.com';
  return domain;
}

test.describe('cc-connect real Feishu channel runtime smoke', () => {
  test('validates Feishu/Lark channel config, runtime status, and lifecycle refresh through cc-connect', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    test.skip(process.env.CLAWX_REAL_FEISHU_E2E !== '1', 'Set CLAWX_REAL_FEISHU_E2E=1 to run with real Feishu/Lark credentials.');
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const appId = requiredEnv('CLAWX_REAL_FEISHU_APP_ID');
    const appSecret = requiredEnv('CLAWX_REAL_FEISHU_APP_SECRET');
    const accountId = process.env.CLAWX_REAL_FEISHU_ACCOUNT_ID?.trim() || 'real_feishu_bot';
    const allowFrom = process.env.CLAWX_REAL_FEISHU_ALLOW_FROM?.trim() || '*';
    const adminFrom = requiredEnv('CLAWX_REAL_FEISHU_ADMIN_FROM');
    const domain = feishuDomainInput();
    const platformType = expectedPlatformType(domain);
    const expectedDomain = expectedDomainUrl(domain, platformType);

    const authSource = await copyLocalCodexAuthToManagedHome(userDataDir);
    await access(authSource);

    const openClawConfigDir = join(homeDir, '.openclaw');
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const mainWorkspace = join(userDataDir, 'real-feishu-workspaces', 'main');
    const opsWorkspace = join(userDataDir, 'real-feishu-workspaces', 'ops');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(opsWorkspace, { recursive: true });

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
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: mainWorkspace },
          { id: 'ops', name: 'Ops Agent', workspace: opsWorkspace },
        ],
      },
      bindings: [
        { match: { channel: 'feishu', accountId }, agentId: 'ops' },
      ],
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: accountId,
          accounts: {
            [accountId]: {
              appId,
              appSecret,
              domain,
              allowFrom,
              adminFrom,
              shareSessionInChannel: true,
              enableFeishuCard: false,
            },
          },
        },
      },
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
          id: 'runtime-start-real-feishu-channel',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      const managedConfigPath = join(runtimeDir, 'config.toml');
      const managedConfig = await readFile(managedConfigPath, 'utf8');
      expect(managedConfig).toContain('name = "clawx-ops"');
      expect(managedConfig).toContain(`work_dir = "${opsWorkspace}"`);
      expect(managedConfig).toContain(`type = "${platformType}"`);
      expect(managedConfig).toContain(`app_id = "${appId}"`);
      expect(managedConfig).toContain(`domain = "${expectedDomain}"`);
      expect(managedConfig).toContain(`allow_from = "${allowFrom}"`);
      expect(managedConfig).toContain(`admin_from = "${adminFrom}"`);
      expect(managedConfig).toContain('share_session_in_channel = true');
      expect(managedConfig).toContain('enable_feishu_card = false');
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());

      const channelsAccounts = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-accounts-real-feishu',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAccounts).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'feishu',
              accounts: expect.arrayContaining([
                expect.objectContaining({
                  accountId,
                  configured: true,
                  connected: true,
                  running: true,
                  linked: true,
                }),
              ]),
            }),
          ]),
        },
      });

      const disconnectResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-disconnect-real-feishu',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'channels.disconnect',
            params: { channelType: 'feishu' },
            timeoutMs: 60_000,
          },
        });
      });
      expect(disconnectResult).toMatchObject({ ok: true, data: { success: true } });

      const connectResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-connect-real-feishu',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'channels.connect',
            params: { channelType: 'feishu' },
            timeoutMs: 60_000,
          },
        });
      });
      expect(connectResult).toMatchObject({ ok: true, data: { success: true } });

      const channelsAfterReload = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-after-reload-real-feishu',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAfterReload).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'feishu',
              accounts: expect.arrayContaining([
                expect.objectContaining({
                  accountId,
                  configured: true,
                  connected: true,
                  running: true,
                  linked: true,
                }),
              ]),
            }),
          ]),
        },
      });

      const deleteConfigResult = await page.evaluate(async (targetAccountId) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-delete-config-real-feishu',
          module: 'channels',
          action: 'deleteConfig',
          payload: { channelType: 'feishu', accountId: targetAccountId },
        });
      }, accountId);
      expect(deleteConfigResult).toMatchObject({ ok: true, data: { success: true } });

      await expect.poll(async () => {
        const refreshedConfig = await readFile(managedConfigPath, 'utf8');
        return {
          hasFeishuPlatform: refreshedConfig.includes(`type = "${platformType}"`),
          hasAppId: refreshedConfig.includes(appId),
        };
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual({ hasFeishuPlatform: false, hasAppId: false });

      const channelsAfterDelete = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-after-delete-real-feishu',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAfterDelete).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.not.arrayContaining([
            expect.objectContaining({ channelType: 'feishu' }),
          ]),
        },
      });
    } finally {
      await closeElectronApp(app);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });

  test('observes a real inbound Feishu/Lark tenant message through the public session API', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    test.skip(
      process.env.CLAWX_REAL_FEISHU_INBOUND_E2E !== '1',
      'Set CLAWX_REAL_FEISHU_INBOUND_E2E=1 to run the manual tenant-message inbound smoke.',
    );
    const timeoutMs = Number(process.env.CLAWX_REAL_FEISHU_INBOUND_TIMEOUT_MS || 180_000);
    test.setTimeout(Math.max(60_000, timeoutMs + 45_000));

    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const appId = requiredEnv('CLAWX_REAL_FEISHU_APP_ID');
    const appSecret = requiredEnv('CLAWX_REAL_FEISHU_APP_SECRET');
    const accountId = process.env.CLAWX_REAL_FEISHU_ACCOUNT_ID?.trim() || 'real_feishu_bot';
    const allowFrom = process.env.CLAWX_REAL_FEISHU_ALLOW_FROM?.trim() || '*';
    const domain = feishuDomainInput();
    const marker = process.env.CLAWX_REAL_FEISHU_INBOUND_MARKER?.trim()
      || `CLAWX_FEISHU_INBOUND_${Date.now()}`;
    const markerArtifactPath = await writeFeishuInboundMarkerArtifact(process.cwd(), {
      marker,
      accountId,
      domain,
      timeoutMs,
    });

    const authSource = await copyLocalCodexAuthToManagedHome(userDataDir);
    await access(authSource);

    const openClawConfigDir = join(homeDir, '.openclaw');
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const mainWorkspace = join(userDataDir, 'real-feishu-inbound-workspaces', 'main');
    const opsWorkspace = join(userDataDir, 'real-feishu-inbound-workspaces', 'ops');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(opsWorkspace, { recursive: true });

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
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: mainWorkspace },
          { id: 'ops', name: 'Ops Agent', workspace: opsWorkspace },
        ],
      },
      bindings: [
        { match: { channel: 'feishu', accountId }, agentId: 'ops' },
      ],
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: accountId,
          accounts: {
            [accountId]: {
              appId,
              appSecret,
              domain,
              allowFrom,
              shareSessionInChannel: true,
              enableFeishuCard: false,
            },
          },
        },
      },
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
          id: 'runtime-start-real-feishu-inbound',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      const channelsAccounts = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-accounts-real-feishu-inbound',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAccounts).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'feishu',
              accounts: expect.arrayContaining([
                expect.objectContaining({
                  accountId,
                  configured: true,
                  connected: true,
                  running: true,
                }),
              ]),
            }),
          ]),
        },
      });

      console.log(`[cc-connect-real-feishu-inbound] Send this exact message to the configured Feishu/Lark bot before timeout: ${marker}`);
      console.log(`[cc-connect-real-feishu-inbound] Marker artifact: ${markerArtifactPath}`);

      await expect.poll(async () => await findMarkerThroughHostApi(page, marker), {
        timeout: timeoutMs,
        intervals: [1_000, 2_000, 5_000],
        message: `real Feishu/Lark tenant message "${marker}" should appear through ClawX public session history`,
      }).toMatchObject({ found: true });
    } finally {
      await closeElectronApp(app);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });
});
