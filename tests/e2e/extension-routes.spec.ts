import react from '@vitejs/plugin-react';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('renders a cold extension URL and reload without waiting for unrelated initialization', async ({ launchElectronApp, homeDir }) => {
  test.setTimeout(180_000);
  const repoRoot = resolve(process.cwd());
  const outDir = join(homeDir, 'extension-renderer');
  await build({
    configFile: false,
    root: repoRoot,
    base: './',
    logLevel: 'warn',
    plugins: [react()],
    resolve: {
      alias: [
        { find: './extensions/_ext-bridge.generated', replacement: join(repoRoot, 'tests/e2e/fixtures/renderer-extension.tsx') },
        { find: '@', replacement: join(repoRoot, 'src') },
        { find: '@shared', replacement: join(repoRoot, 'shared') },
      ],
      dedupe: ['react', 'react-dom', 'react-i18next', 'zustand', 'sonner', 'lucide-react'],
    },
    build: { outDir, minify: false, reportCompressedSize: false },
  });

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
