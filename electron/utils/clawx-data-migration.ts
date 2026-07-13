import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ClawXDataLayout } from './clawx-data-layout';

export interface ClawXLegacyMigrationResult {
  skipped: boolean;
  copied: string[];
  source: string;
  target: string;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

async function copyIfMissing(source: string, target: string, copied: string[]): Promise<void> {
  if (!(await exists(source))) return;
  if (await exists(target)) {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory() || (await readdir(target)).length > 0) return;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: async (sourcePath) => {
      const entry = await lstat(sourcePath);
      return entry.isDirectory() || entry.isFile() || entry.isSymbolicLink();
    },
  });
  copied.push(target);
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

async function appendJournal(layout: ClawXDataLayout, record: Record<string, unknown>): Promise<void> {
  await mkdir(layout.stateDir, { recursive: true });
  const previous = await readFile(layout.migrationJournalPath, 'utf8').catch(() => '');
  await writeFile(layout.migrationJournalPath, `${previous}${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function migrateLegacyClawXData(options: {
  legacyElectronUserDataDir: string;
  layout: ClawXDataLayout;
}): Promise<ClawXLegacyMigrationResult> {
  const source = await canonicalPath(options.legacyElectronUserDataDir);
  const target = await canonicalPath(options.layout.root);
  const electronUserDataDir = await canonicalPath(options.layout.electronUserDataDir);
  if (
    source === electronUserDataDir
    || source === target
    || source.startsWith(`${target}/`)
  ) {
    return { skipped: true, copied: [], source, target };
  }

  const copied: string[] = [];
  for (const fileName of ['settings.json', 'clawx-providers.json']) {
    await copyIfMissing(join(source, fileName), join(options.layout.appDir, fileName), copied);
  }
  for (const fileName of ['window-state.json', 'clawx-device-identity.json']) {
    await copyIfMissing(join(source, fileName), join(options.layout.electronUserDataDir, fileName), copied);
  }
  await copyIfMissing(
    join(source, 'runtimes', 'cc-connect'),
    options.layout.ccConnectRuntimeDir,
    copied,
  );
  await copyIfMissing(join(source, 'logs'), options.layout.logsDir, copied);

  await appendJournal(options.layout, {
    schema: 'clawx-data-migration',
    version: 1,
    migration: 'legacy-electron-user-data-import',
    source,
    target,
    copied: copied.map((path) => basename(path)),
    completedAt: new Date().toISOString(),
  });
  return { skipped: false, copied, source, target };
}
