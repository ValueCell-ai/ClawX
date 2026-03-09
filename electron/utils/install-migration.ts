import { app } from 'electron';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

function hasAnyEntries(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function copyTreeMissingOnly(sourceDir: string, targetDir: string): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;

  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      if (!existsSync(targetPath)) {
        mkdirSync(targetPath, { recursive: true });
      }
      const nested = copyTreeMissingOnly(sourcePath, targetPath);
      copied += nested.copied;
      skipped += nested.skipped;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (existsSync(targetPath)) {
      skipped += 1;
      continue;
    }

    copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  return { copied, skipped };
}

function getLegacyUserDataCandidates(): string[] {
  const appData = app.getPath('appData');
  const localAppData = process.platform === 'win32' ? process.env.LOCALAPPDATA || null : null;

  const candidates = [
    join(appData, 'OpenClaw'),
    join(appData, 'openclaw'),
    join(appData, 'OpenClaw Desktop'),
  ];

  if (localAppData) {
    candidates.push(join(localAppData, 'OpenClaw'));
    candidates.push(join(localAppData, 'openclaw'));
  }

  return Array.from(new Set(candidates));
}

export function migrateLegacyOpenClawUserData(): void {
  try {
    const targetUserData = app.getPath('userData');
    const targetExists = existsSync(targetUserData);
    const targetHasData = targetExists && hasAnyEntries(targetUserData);
    const candidates = getLegacyUserDataCandidates();

    for (const sourceDir of candidates) {
      if (!existsSync(sourceDir)) {
        continue;
      }
      if (sourceDir === targetUserData) {
        continue;
      }

      let sourceStat;
      try {
        sourceStat = statSync(sourceDir);
      } catch {
        continue;
      }
      if (!sourceStat.isDirectory() || !hasAnyEntries(sourceDir)) {
        continue;
      }

      if (!targetExists) {
        mkdirSync(targetUserData, { recursive: true });
      }

      const { copied, skipped } = copyTreeMissingOnly(sourceDir, targetUserData);
      if (copied > 0 || skipped > 0) {
        logger.info(
          `[InstallMigration] Migrated legacy OpenClaw data from "${sourceDir}" -> "${targetUserData}" (copied=${copied}, skipped=${skipped}, targetHadData=${targetHasData})`,
        );
        return;
      }
    }
  } catch (error) {
    logger.warn('[InstallMigration] Failed to migrate legacy OpenClaw user data:', error);
  }
}
