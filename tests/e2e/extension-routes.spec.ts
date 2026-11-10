import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { E2E_EXCLUSIVE_TAG } from './parallel-policy';

async function buildExtensionRenderer(outDir: string): Promise<void> {
  const repoRoot = resolve(process.cwd());
  // Vite's full application graph can exceed the worker's default 2 GB heap.
  // Match build:vite's budget in a short-lived child, then release the graph
  // before Electron starts rather than retaining it in the Playwright worker.
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    '--max-old-space-size=6144',
    join(repoRoot, 'tests/e2e/fixtures/build-extension-renderer.mjs'),
    outDir,
  ], { cwd: repoRoot, timeout: 150_000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (stdout) console.log(stdout.trim());
  if (stderr) console.warn(stderr.trim());
}

test('renders a cold extension URL and reload without waiting for unrelated initialization', { tag: E2E_EXCLUSIVE_TAG }, async ({ launchElectronApp, homeDir }) => {
  test.setTimeout(180_000);
  const outDir = join(homeDir, 'extension-renderer');
  await buildExtensionRenderer(outDir);

  const app = await launchElectronApp({ skipSetup: true });
  try {
    // Hold settings initialization so it cannot accidentally repair the root
    // route tree by triggering a render after extension registration.
    await app.evaluate(({ ipcMain }) => {
      const original = (ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, request: unknown) => unknown>;
      })._invokeHandlers.get('host:invoke')!;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', (event, request) => {
        if (request.module === 'settings' && request.action === 'getAll') {
          return new Promise(() => {});
        }
        return original(event, request);
      });
    });
    const page = await getStableWindow(app);
    const url = pathToFileURL(join(outDir, 'index.html'));
    url.searchParams.set('e2eSkipSetup', '1');
    url.hash = '/extension-test';
    await page.goto(url.href);
    await expect(page.getByTestId('extension-route-page')).toBeVisible();
    await expect(page.getByTestId('extension-route-nav')).toBeVisible();
    await expect(page).toHaveURL(/#\/extension-test$/);

    await page.reload();
    await expect(page.getByTestId('extension-route-page')).toBeVisible();
    await expect(page.getByTestId('extension-route-nav')).toBeVisible();
    await expect(page).toHaveURL(/#\/extension-test$/);
  } finally {
    await closeElectronApp(app);
  }
});
