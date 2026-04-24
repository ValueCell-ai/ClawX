import { describe, expect, it } from 'vitest';

import { resolveAvailableVersion } from '../../scripts/release-version-utils.mjs';

describe('release version utils', () => {
  it('skips occupied prerelease tags on the same release line', () => {
    const result = resolveAvailableVersion({
      currentVersion: '0.3.11',
      releaseType: 'prerelease',
      preid: 'alpha',
      hasTag: (version: string) => version === '0.3.12-alpha.0',
    });

    expect(result.initialVersion).toBe('0.3.12-alpha.0');
    expect(result.skippedVersions).toEqual(['0.3.12-alpha.0']);
    expect(result.version).toBe('0.3.12-alpha.1');
  });

  it('keeps incrementing patch releases until a free tag is found', () => {
    const occupiedVersions = new Set(['0.3.12', '0.3.13']);
    const result = resolveAvailableVersion({
      currentVersion: '0.3.11',
      releaseType: 'patch',
      hasTag: (version: string) => occupiedVersions.has(version),
    });

    expect(result.skippedVersions).toEqual(['0.3.12', '0.3.13']);
    expect(result.version).toBe('0.3.14');
  });

  it('continues the same prerelease stream when already on that preid', () => {
    const result = resolveAvailableVersion({
      currentVersion: '0.3.12-alpha.1',
      releaseType: 'prerelease',
      preid: 'alpha',
      hasTag: () => false,
    });

    expect(result.version).toBe('0.3.12-alpha.2');
  });
});
