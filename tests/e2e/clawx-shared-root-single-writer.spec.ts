import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function waitForMissing(path: string): Promise<void> {
  await expect.poll(async () => {
    try {
      await access(path);
      return false;
    } catch {
      return true;
    }
  }, { timeout: 10_000 }).toBe(true);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test.describe('ClawX shared-root writer ownership', () => {
  test('allows only one Electron writer and transfers ownership after shutdown', async ({
    homeDir,
    launchElectronApp,
  }, testInfo) => {
    const dataRoot = join(homeDir, '.clawx-shared-root');
    const lockPath = join(dataRoot, 'locks', 'writer.lock');
    const duplicateUserDataDir = join(homeDir, 'electron-beta');
    const launchOptions = (electronUserDataDir: string, channel: string) => ({
      skipSetup: true,
      timeoutMs: 15_000,
      env: {
        CLAWX_DATA_HOME: dataRoot,
        CLAWX_USER_DATA_DIR: electronUserDataDir,
        CLAWX_E2E_ENFORCE_WRITER_LOCK: '1',
        CLAWX_RELEASE_CHANNEL: channel,
      },
    } as const);

    const first = await launchElectronApp(launchOptions(join(homeDir, 'electron-stable'), 'stable'));
    let firstClosed = false;
    let successor: Awaited<ReturnType<typeof launchElectronApp>> | undefined;
    try {
      const firstPage = await getStableWindow(first);
      const firstMainPid = await first.evaluate(() => process.pid);
      await expect(firstPage.getByTestId('main-layout')).toBeVisible();

      const firstOwner = JSON.parse(await readFile(lockPath, 'utf8')) as {
        schema?: string;
        version?: number;
        pid?: number;
        channel?: string;
      };
      expect(firstOwner).toMatchObject({
        schema: 'clawx-instance-lock',
        version: 2,
        pid: firstMainPid,
        channel: 'stable',
      });

      let duplicateLaunchError: unknown;
      try {
        const duplicate = await launchElectronApp(launchOptions(duplicateUserDataDir, 'beta'));
        await closeElectronApp(duplicate);
      } catch (error) {
        duplicateLaunchError = error;
      }
      expect(duplicateLaunchError).toBeDefined();

      const ownerAfterDuplicate = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number };
      expect(ownerAfterDuplicate.pid).toBe(firstMainPid);
      expect(await pathExists(duplicateUserDataDir)).toBe(false);
      await expect(firstPage.getByTestId('main-layout')).toBeVisible();

      await testInfo.attach('shared-root-first-writer', {
        body: await firstPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });

      await closeElectronApp(first);
      firstClosed = true;
      await waitForMissing(lockPath);

      successor = await launchElectronApp(launchOptions(join(homeDir, 'electron-dev'), 'dev'));
      const successorPage = await getStableWindow(successor);
      const successorMainPid = await successor.evaluate(() => process.pid);
      await expect(successorPage.getByTestId('main-layout')).toBeVisible();
      const successorOwner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number; channel?: string };
      expect(successorOwner).toMatchObject({ pid: successorMainPid, channel: 'dev' });
      expect(successorOwner.pid).not.toBe(firstOwner.pid);

      await closeElectronApp(successor);
      successor = undefined;
      await waitForMissing(lockPath);

      await testInfo.attach('shared-root-writer-evidence', {
        body: Buffer.from(JSON.stringify({
          schema: 'clawx-shared-root-writer-evidence',
          duplicateRejected: true,
          duplicateLayoutInitializationBlocked: true,
          firstOwnerMatched: true,
          lockReleasedAfterShutdown: true,
          successorAcquired: true,
          successorReleased: true,
        }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      if (!firstClosed) {
        await closeElectronApp(first);
      }
      if (successor) {
        await closeElectronApp(successor);
      }
    }
  });

  test('fails closed before shared-root initialization when the writer lock cannot be acquired', async ({
    homeDir,
    launchElectronApp,
  }, testInfo) => {
    const dataRoot = join(homeDir, '.clawx-invalid-lock-root');
    const electronUserDataDir = join(homeDir, 'electron-invalid-lock');
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(dataRoot, 'locks'), 'not-a-directory', 'utf8');

    let launchError: unknown;
    try {
      const app = await launchElectronApp({
        skipSetup: true,
        timeoutMs: 15_000,
        env: {
          CLAWX_DATA_HOME: dataRoot,
          CLAWX_USER_DATA_DIR: electronUserDataDir,
          CLAWX_E2E_ENFORCE_WRITER_LOCK: '1',
        },
      });
      await closeElectronApp(app);
    } catch (error) {
      launchError = error;
    }

    expect(launchError).toBeDefined();
    expect(await pathExists(join(dataRoot, 'state', 'data-version.json'))).toBe(false);
    expect(await pathExists(electronUserDataDir)).toBe(false);

    await testInfo.attach('shared-root-lock-failure-evidence', {
      body: Buffer.from(JSON.stringify({
        schema: 'clawx-shared-root-lock-failure-evidence',
        launchRejected: true,
        dataVersionWriteBlocked: true,
        electronUserDataInitializationBlocked: true,
      }, null, 2)),
      contentType: 'application/json',
    });
  });
});
