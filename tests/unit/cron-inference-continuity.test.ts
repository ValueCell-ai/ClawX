// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCronInferenceLaunchManifest } from '@electron/gateway/cron-inference-continuity';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('managed launch cron account evidence', () => {
  it('keeps a snapshot-only launch unchanged', async () => {
    expect(await writeCronInferenceLaunchManifest('unused', undefined, [])).toBeUndefined();
    expect(await writeCronInferenceLaunchManifest('unused', 'snapshot-plan.json', [])).toBe('snapshot-plan.json');
  });

  it('lets same-session continuation replace only the matching historical task evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-cron-continuity-'));
    roots.push(root);
    const snapshot = join(root, 'snapshot-plan.json');
    const baseline = { version: 1, jobs: [{ jobId: 'same', definition: { name: 'old' } }, { jobId: 'other' }] };
    await writeFile(snapshot, JSON.stringify(baseline));
    const entry = {
      jobId: 'same', definition: { name: 'current' }, agentId: 'main', model: 'enterprise/latest',
      profileId: 'enterprise:default', credentialDigest: 'a'.repeat(64),
      expectedPreviousBinding: { provider: 'enterprise', profileId: 'enterprise:default', authorizationId: 'previous' },
    };
    const manifestPath = await writeCronInferenceLaunchManifest(root, snapshot, [entry]);
    expect(JSON.parse(await readFile(manifestPath!, 'utf8'))).toEqual({ version: 1, jobs: [{ jobId: 'other' }, entry] });
    expect(JSON.parse(await readFile(snapshot, 'utf8'))).toEqual(baseline);
    // A subsequent managed launch cannot retain evidence from a prior session.
    await writeCronInferenceLaunchManifest(root, undefined, [{ ...entry, jobId: 'different' }]);
    expect(JSON.parse(await readFile(manifestPath!, 'utf8')).jobs.map((job: { jobId: string }) => job.jobId)).toEqual(['different']);
  });
});
