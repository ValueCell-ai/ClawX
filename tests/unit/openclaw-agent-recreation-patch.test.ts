// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw Agent recreation compatibility patch', () => {
  it('claims a completed deletion tombstone before recreating the same Agent ID', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      pnpm?: { patchedDependencies?: Record<string, string> };
    };
    const patch = readFileSync(
      resolve(process.cwd(), 'patches/openclaw@2026.8.2.patch'),
      'utf8',
    );

    expect(packageJson.pnpm?.patchedDependencies?.['openclaw@2026.8.2'])
      .toBe('patches/openclaw@2026.8.2.patch');
    expect(patch).toContain('if (deletion?.cleanupCompleted) {');
    expect(patch).toContain('deletion.deleteFiles === false');
    expect(patch).toContain('prepareWorkspaceStateDeletion(recreationWorkspaceDir)');
    expect(patch).toContain('deleteWorkspaceState(vanishedWorkspaceStatePlan)');
    expect(patch).not.toContain(
      '+\t\t\tif (deletion?.cleanupCompleted && findAgentEntryIndex',
    );
  });
});
