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
          'chat.abort': { capability: 'chat', support: 'unsupported', notes: 'cc-connect BridgePlatform does not expose an abort RPC yet.' },
          'doctor.fix': { capability: 'doctor', support: 'unsupported', notes: 'cc-connect v1.3.2 does not support doctor fix mode.' },
        },
      },
    });

    await completeSetup(page);
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
          'chat.abort': expect.objectContaining({ support: 'unsupported' }),
        }),
      },
    });
    await expect(page.getByTestId('settings-runtime-operation-gaps')).toContainText('chat.abort');
    await expect(page.getByTestId('settings-runtime-operation-gaps')).toContainText('doctor.fix');

    await expect(page.getByTestId('settings-run-doctor-button')).toBeVisible();
    await expect(page.getByTestId('settings-run-doctor-fix-button')).toBeDisabled();
    await expect(page.getByTestId('sidebar-open-dev-console')).toContainText('CC Connect Page');
    await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);
  });
});
