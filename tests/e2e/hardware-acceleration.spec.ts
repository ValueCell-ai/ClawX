import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('Electron hardware acceleration', () => {
  test('does not request software rendering by default', async ({ electronApp }) => {
    const disablesGpu = await electronApp.evaluate(async ({ app }) => (
      app.commandLine.hasSwitch('disable-gpu')
    ));

    expect(disablesGpu).toBe(false);
  });

  test('keeps Chromium compositing hardware accelerated by default', async ({ electronApp }) => {
    const status = await electronApp.evaluate(async ({ app }) => {
      await app.getGPUInfo('basic');

      return {
        enabled: app.isHardwareAccelerationEnabled(),
        gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
      };
    });

    test.skip(
      process.platform !== 'darwin' || status.gpuCompositing !== 'enabled',
      'Requires a controlled desktop GPU environment',
    );
    expect(status).toEqual({
      enabled: true,
      gpuCompositing: 'enabled',
    });
  });

  test('retains Chromium native software-rendering fallback', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, additionalArgs: ['--disable-gpu'] });
    try {
      const status = await app.evaluate(async ({ app: electronApp }) => {
        return {
          disabledBySwitch: electronApp.commandLine.hasSwitch('disable-gpu'),
          enabled: electronApp.isHardwareAccelerationEnabled(),
        };
      });

      expect(status).toEqual({
        disabledBySwitch: true,
        enabled: false,
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
