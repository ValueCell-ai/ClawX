const { test, expect, _electron: electron } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..', '..');

async function getStableWindow(app) {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function expectRoutePage(page, hash, testId) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
  await page.waitForFunction((expectedHash) => window.location.hash === expectedHash, hash);
  await expect(page.getByTestId(testId)).toBeVisible();
}

test('launches the packaged Electron app and renders core pages', async () => {
  const userDataDir = await mkdtemp(`${tmpdir()}/clawx-e2e-`);
  let app = null;

  try {
    app = await electron.launch({
      args: ['.'],
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWX_E2E_SKIP_SETUP: '1',
        CLAWX_USER_DATA_DIR: userDataDir,
      },
    });

    const page = await getStableWindow(app);

    await expectRoutePage(page, '#/models', 'models-page');
    await expectRoutePage(page, '#/agents', 'agents-page');
    await expectRoutePage(page, '#/channels', 'channels-page');
  } finally {
    await app?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
