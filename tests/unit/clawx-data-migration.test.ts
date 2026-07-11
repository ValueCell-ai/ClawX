import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getClawXDataLayout, initializeClawXDataLayout } from '@electron/utils/clawx-data-layout';
import { migrateLegacyClawXData } from '@electron/utils/clawx-data-migration';

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('legacy ClawX data migration', () => {
  it('copies application state and cc-connect data without deleting the legacy source', async () => {
    const source = await tempRoot('clawx-legacy-data-');
    const root = await tempRoot('clawx-new-data-');
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);
    await mkdir(join(source, 'runtimes', 'cc-connect'), { recursive: true });
    await mkdir(join(source, 'logs'), { recursive: true });
    await writeFile(join(source, 'settings.json'), '{"runtimeKind":"cc-connect"}\n');
    await writeFile(join(source, 'clawx-providers.json'), '{"providerAccounts":{}}\n');
    await writeFile(join(source, 'runtimes', 'cc-connect', 'config.toml'), 'data_dir = "legacy"\n');
    await writeFile(join(source, 'logs', 'clawx.log'), 'legacy log\n');

    const result = await migrateLegacyClawXData({ legacyElectronUserDataDir: source, layout });

    expect(result.copied).toHaveLength(4);
    await expect(readFile(join(layout.appDir, 'settings.json'), 'utf8')).resolves.toContain('cc-connect');
    await expect(readFile(join(layout.appDir, 'clawx-providers.json'), 'utf8')).resolves.toContain('providerAccounts');
    await expect(readFile(join(layout.ccConnectRuntimeDir, 'config.toml'), 'utf8')).resolves.toContain('legacy');
    await expect(readFile(join(layout.logsDir, 'clawx.log'), 'utf8')).resolves.toContain('legacy log');
    await expect(readFile(join(source, 'settings.json'), 'utf8')).resolves.toContain('cc-connect');
    await expect(readFile(layout.migrationJournalPath, 'utf8')).resolves.toContain('legacy-electron-user-data-import');
  });

  it('does not overwrite state already created in the shared root', async () => {
    const source = await tempRoot('clawx-legacy-data-');
    const root = await tempRoot('clawx-new-data-');
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);
    await mkdir(layout.appDir, { recursive: true });
    await writeFile(join(source, 'settings.json'), '{"theme":"light"}\n');
    await writeFile(join(layout.appDir, 'settings.json'), '{"theme":"dark"}\n');

    const result = await migrateLegacyClawXData({ legacyElectronUserDataDir: source, layout });

    expect(result.copied).toEqual([]);
    await expect(readFile(join(layout.appDir, 'settings.json'), 'utf8')).resolves.toContain('dark');
  });

  it('skips migration when the old path is already inside the shared root', async () => {
    const root = await tempRoot('clawx-new-data-');
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);

    await expect(migrateLegacyClawXData({
      legacyElectronUserDataDir: layout.electronUserDataDir,
      layout,
    })).resolves.toMatchObject({ skipped: true, copied: [] });
  });

  it('skips migration when legacy and shared roots are filesystem aliases', async () => {
    const parent = await tempRoot('clawx-data-alias-');
    const root = join(parent, 'root');
    const alias = join(parent, 'alias');
    await mkdir(root, { recursive: true });
    await symlink(root, alias, 'dir');
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);

    await expect(migrateLegacyClawXData({
      legacyElectronUserDataDir: alias,
      layout,
    })).resolves.toMatchObject({ skipped: true, copied: [] });
  });

  it.skipIf(process.platform === 'win32')('ignores runtime sockets while importing legacy data', async () => {
    const source = `/tmp/clawx-socket-${process.pid}-${Date.now()}`;
    roots.push(source);
    await mkdir(source, { recursive: true });
    const root = await tempRoot('clawx-new-socket-');
    const socketPath = join(source, 'runtimes', 'cc-connect', 'data', 'run', 'api.sock');
    await mkdir(join(source, 'runtimes', 'cc-connect', 'data', 'run'), { recursive: true });
    await writeFile(join(source, 'runtimes', 'cc-connect', 'config.toml'), 'data_dir = "legacy"\n');
    const server = createServer();
    await new Promise<void>((resolveReady, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolveReady);
    });
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);

    try {
      await expect(migrateLegacyClawXData({ legacyElectronUserDataDir: source, layout }))
        .resolves.toMatchObject({ skipped: false });
      await expect(readFile(join(layout.ccConnectRuntimeDir, 'config.toml'), 'utf8'))
        .resolves.toContain('legacy');
      await expect(stat(join(layout.ccConnectRuntimeDir, 'data', 'run', 'api.sock'))).rejects.toThrow();
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
