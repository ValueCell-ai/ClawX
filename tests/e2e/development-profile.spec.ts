import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('legacy developer runtime uses independent app and OpenClaw paths', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true, developmentProfile: 'legacy' });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('chat-toolbar-workspace')).toBeVisible();
    const paths = await app.evaluate(({ app }) => ({
      userData: app.getPath('userData'), state: process.env.OPENCLAW_STATE_DIR,
      config: process.env.OPENCLAW_CONFIG_PATH, port: process.env.CLAWX_PORT_OPENCLAW_GATEWAY,
    }));
    expect(paths.userData).toContain('/legacy-profile/clawx');
    expect(paths.state).toContain('/legacy-profile/openclaw');
    expect(paths.config).toBe(`${paths.state}/openclaw.json`);
    expect(paths.port).toBe('19789');
    await page.getByTestId('chat-toolbar-workspace').click();
    await expect(page.getByTestId('artifact-panel')).toBeVisible();
  } finally { await closeElectronApp(app); }
});
