import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Settings runtime selector', () => {
  test('switches to cc-connect and shows runtime capabilities', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: {
        state: 'stopped',
        port: 0,
        runtimeKind: 'cc-connect',
        configDir: '/tmp/clawx/runtimes/cc-connect',
        capabilities: {
          chat: true,
          sessions: true,
          history: true,
          providers: true,
          models: true,
          channels: true,
          cron: true,
          logs: true,
          skills: true,
          doctor: true,
          controlUi: true,
        },
        operationCapabilities: {
          'chat.send': { capability: 'chat', support: 'native', notes: 'Delivered through cc-connect BridgePlatform into Codex.' },
          'chat.abort': { capability: 'chat', support: 'native', notes: 'Stops the active cc-connect Bridge session.' },
          'doctor.fix': { capability: 'doctor', support: 'unsupported', notes: 'cc-connect Doctor does not support fix mode.' },
        },
      },
      hostApi: {
        [JSON.stringify(['/api/diagnostics/gateway-snapshot', 'GET'])]: {
          capturedAt: 123,
          platform: 'darwin',
          gateway: { state: 'healthy', reasons: [] },
          runtime: {
            activeKind: 'cc-connect',
            status: {
              runtimeKind: 'cc-connect',
              configDir: '/tmp/clawx/runtimes/cc-connect',
            },
            ccConnect: {
              managedDir: '/tmp/clawx/runtimes/cc-connect',
              codexHomeDir: '/tmp/clawx/runtimes/cc-connect/codex-home',
              oauth: { success: true, managed: { complete: true } },
            },
          },
          channels: [],
          clawxLogTail: 'clawx-log',
          gatewayLogTail: '',
          gatewayErrLogTail: '',
        },
      },
    });

    await completeSetup(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (value: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__copiedRuntimeDiagnostics = value;
            return Promise.resolve();
          },
        },
        configurable: true,
      });
    });
    await page.getByTestId('sidebar-nav-settings').click();

    await expect(page.getByTestId('settings-runtime-section')).toHaveCount(0);
    const devModeToggle = page.getByTestId('settings-dev-mode-switch');
    await devModeToggle.click();

    await expect(page.getByTestId('settings-runtime-section')).toBeVisible();
    await page.getByTestId('settings-runtime-cc-connect').click();

    await expect(page.getByTestId('settings-runtime-cc-connect')).toBeVisible();
    await expect(page.getByTestId('settings-runtime-config-dir')).toContainText('cc-connect');
    await expect(page.getByTestId('settings-runtime-capabilities')).toContainText('Doctor');
    const statusAfterSwitch = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'settings-runtime-status',
        module: 'gateway',
        action: 'status',
      });
    });
    expect(statusAfterSwitch).toMatchObject({
      ok: true,
      data: {
        operationCapabilities: expect.objectContaining({
          'chat.abort': expect.objectContaining({ support: 'native' }),
        }),
      },
    });
    await expect(page.getByTestId('settings-runtime-operation-gaps')).not.toContainText('chat.abort');
    await expect(page.getByTestId('settings-runtime-operation-gaps')).toContainText('Limited');
    await expect(page.getByTestId('settings-runtime-operation-gaps')).toContainText('doctor.fix');

    await expect(page.getByTestId('settings-run-doctor-button')).toBeVisible();
    await expect(page.getByTestId('settings-run-doctor-fix-button')).toBeDisabled();
    await expect(page.getByTestId('settings-runtime-diagnostics-section')).toBeVisible();
    await page.getByTestId('settings-copy-runtime-diagnostics').click();
    const copiedDiagnostics = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__copiedRuntimeDiagnostics as string;
    });
    expect(copiedDiagnostics).toContain('"activeKind": "cc-connect"');
    expect(copiedDiagnostics).toContain('"codexHomeDir": "/tmp/clawx/runtimes/cc-connect/codex-home"');
    await expect(page.getByTestId('sidebar-open-dev-console')).toContainText('CC Connect Page');
    await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);
  });
});
