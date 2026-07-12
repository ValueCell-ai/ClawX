import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import type { Page } from '@playwright/test';

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

async function expectAssistantText(page: Page, text: string, timeout = 180_000): Promise<void> {
  await expect(page.getByTestId('chat-message-role-assistant').filter({ hasText: text }).last()).toBeVisible({ timeout });
}

function oauthEvidencePathMasks(page: Page, workspace: string) {
  return [
    page.getByTestId('chat-execution-step').filter({ hasText: workspace }),
    page.getByTestId('generated-file-card-clawx-real-oauth-tool.txt')
      .locator('span')
      .filter({ hasText: workspace }),
  ];
}

test.describe('cc-connect real OpenAI OAuth chat', () => {
  test('sends a chat message through real cc-connect and Codex OAuth', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    test.setTimeout(480_000);
    test.skip(process.env.CLAWX_REAL_OAUTH_E2E !== '1', 'Set CLAWX_REAL_OAUTH_E2E=1 with an explicit CLAWX_REAL_CODEX_AUTH_JSON.');
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');

    const authSource = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
    test.skip(!authSource, 'Set CLAWX_REAL_CODEX_AUTH_JSON to the auth.json copied into the isolated managed CODEX_HOME.');
    const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
    await mkdir(managedCodexHome, { recursive: true });
    await copyFile(authSource!, join(managedCodexHome, 'auth.json'));
    const workspace = join(userDataDir, 'workspaces', 'agents', 'main');
    await mkdir(workspace, { recursive: true });

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
          model: 'gpt-5.4-mini',
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
    // E2E uses CLAWX_USER_DATA_DIR compatibility mode, where app config is
    // stored at the isolated root rather than under root/app.
    await writeFile(join(userDataDir, 'agent-bindings.json'), JSON.stringify({
      schema: 'clawx-agent-bindings',
      version: 1,
      agents: {
        main: {
          providerAccountId: 'openai-oauth',
          permissionMode: 'suggest',
          updatedAt: createdAt,
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
      await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __ccConnectRuntimeEvents?: Array<{ type?: unknown; phase?: unknown; status?: unknown }>;
        };
        testWindow.__ccConnectRuntimeEvents = [];
        window.electron.ipcRenderer.on('chat:runtime-event', (payload) => {
          testWindow.__ccConnectRuntimeEvents!.push(payload as { type?: unknown; phase?: unknown; status?: unknown });
        });
      });

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-oauth',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });
      const managedConfigPath = join(userDataDir, 'runtimes', 'cc-connect', 'config.toml');
      await expect.poll(async () => await readFile(managedConfigPath, 'utf8'), { timeout: 30_000 })
        .toContain('mode = "suggest"');

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill([
        'Use the apply_patch tool to create a file named clawx-real-oauth-tool.txt in the current workspace.',
        'The file content must be exactly: CLAWX_REAL_OAUTH_TOOL_OK',
        'After writing the file, reply exactly: CLAWX_REAL_OAUTH_E2E_OK',
      ].join(' '));
      await page.getByTestId('chat-composer-send').click();
      const allowApproval = page.getByTestId('chat-approval-action-perm:allow');
      const evidenceDir = join(process.cwd(), 'artifacts', 'cc-connect');
      await mkdir(evidenceDir, { recursive: true });
      try {
        await expect(allowApproval).toBeVisible({ timeout: 240_000 });
      } catch (error) {
        const diagnosticEvents = await page.evaluate(() => {
          const testWindow = window as typeof window & {
            __ccConnectRuntimeEvents?: Array<{ type?: unknown; phase?: unknown; status?: unknown }>;
          };
          return testWindow.__ccConnectRuntimeEvents ?? [];
        });
        const runtimeLog = await readFile(
          join(userDataDir, 'runtimes', 'cc-connect', 'logs', 'runtime.log'),
          'utf8',
        ).catch(() => 'runtime log unavailable');
        await writeFile(join(evidenceDir, 'real-oauth-approval-failure.json'), JSON.stringify({
          configMode: 'suggest',
          runtimeEvents: diagnosticEvents,
          runtimeLog,
        }, null, 2), 'utf8');
        await page.screenshot({
          path: join(evidenceDir, 'real-oauth-approval-failure.png'),
          fullPage: true,
          mask: oauthEvidencePathMasks(page, workspace),
          maskColor: '#e5e7eb',
        });
        throw error;
      }
      await page.screenshot({
        path: join(evidenceDir, 'real-oauth-approval-request.png'),
        fullPage: true,
        mask: oauthEvidencePathMasks(page, workspace),
        maskColor: '#e5e7eb',
      });
      await allowApproval.click();
      await expect.poll(async () => await readFile(join(workspace, 'clawx-real-oauth-tool.txt'), 'utf8').catch(() => ''), {
        timeout: 180_000,
        intervals: [1_000, 2_000, 5_000, 10_000],
      }).toContain('CLAWX_REAL_OAUTH_TOOL_OK');
      await expectAssistantText(page, 'CLAWX_REAL_OAUTH_E2E_OK');
      await expect(page.getByTestId('generated-files-panel')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('generated-file-card-clawx-real-oauth-tool.txt')).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __ccConnectRuntimeEvents?: Array<{ type?: unknown; phase?: unknown; status?: unknown }>;
        };
        const events = testWindow.__ccConnectRuntimeEvents ?? [];
        const types = events.map((event) => event.type);
        return types.includes('tool.started')
          && types.includes('tool.completed')
          && events.some((event) => event.type === 'approval.updated' && event.phase === 'requested')
          && events.some((event) => event.type === 'approval.updated' && event.phase === 'resolved' && event.status === 'approved');
      }), {
        timeout: 60_000,
        message: 'cc-connect public progress packets should surface the real OAuth tool lifecycle',
      }).toBe(true);
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 60_000 });
      const eventTypes = await page.evaluate(() => {
        const testWindow = window as typeof window & {
          __ccConnectRuntimeEvents?: Array<{ type?: unknown; phase?: unknown; status?: unknown }>;
        };
        return (testWindow.__ccConnectRuntimeEvents ?? []).map((event) => String(event.type || 'unknown'));
      });
      const runtimeLog = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'logs', 'runtime.log'), 'utf8');
      expect(runtimeLog).toContain('codex app-server session started');
      expect(runtimeLog).toContain('transport=stdio');
      expect(runtimeLog).toMatch(/turn complete.*tools=1/);
      await page.screenshot({
        path: join(evidenceDir, 'real-oauth-tool-events.png'),
        fullPage: true,
        mask: oauthEvidencePathMasks(page, workspace),
        maskColor: '#e5e7eb',
      });
      await writeFile(join(evidenceDir, 'real-oauth-tool-events.json'), JSON.stringify({
        runtime: 'cc-connect',
        codexBackend: 'app_server',
        transport: 'stdio',
        workspaceManaged: true,
        toolCount: 1,
        approvalMode: 'suggest',
        approvalRequested: true,
        approvalResolved: true,
        eventTypes: Array.from(new Set(eventTypes)),
        screenshot: 'artifacts/cc-connect/real-oauth-tool-events.png',
        approvalScreenshot: 'artifacts/cc-connect/real-oauth-approval-request.png',
      }, null, 2), 'utf8');

      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain('access_token');
      expect(publicProfile).not.toContain('refresh_token');
      expect(publicProfile).not.toContain('id_token');
    } finally {
      await closeElectronApp(app);
    }
  });
});
