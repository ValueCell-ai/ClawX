import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CronInferenceMigrationEntry } from '../utils/openclaw-cron-migration';

/** Produced only by a trusted extension after verifying its encrypted session. */
export interface CronInferenceContinuityEntry extends CronInferenceMigrationEntry {
  expectedPreviousBinding: Record<string, unknown>;
}

export interface GatewayStartupPreparationResult {
  cronInferenceContinuity: CronInferenceContinuityEntry[];
}

export async function writeCronInferenceLaunchManifest(
  directory: string,
  snapshotManifest: string | undefined,
  continuity: readonly CronInferenceContinuityEntry[],
): Promise<string | undefined> {
  if (!continuity.length) return snapshotManifest;
  const previous = snapshotManifest
    ? JSON.parse(await readFile(snapshotManifest, 'utf8')) as { jobs: CronInferenceMigrationEntry[] }
    : { jobs: [] };
  const ids = new Set(continuity.map(entry => entry.jobId));
  const jobs = [...previous.jobs.filter(entry => !ids.has(entry.jobId)), ...continuity];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, 'cron-inference-launch.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, jobs }), { mode: 0o600 });
  await rename(temporary, target);
  return target;
}
