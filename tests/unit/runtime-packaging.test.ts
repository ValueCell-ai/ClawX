// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { archesForPlatform, parseArgs } from '../../scripts/verify-runtime-bundles.mjs';

const repoRoot = process.cwd();

describe('runtime packaging guardrails', () => {
  it('keeps cc-connect and Codex bundle verification wired into packaging scripts', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['verify:runtime-bundles']).toBe('node scripts/verify-runtime-bundles.mjs');
    for (const scriptName of ['build', 'package', 'package:mac', 'package:win', 'package:linux', 'release']) {
      expect(packageJson.scripts[scriptName], `${scriptName} should verify bundled runtimes`).toContain('verify:runtime-bundles');
    }
  });

  it('verifies every packaged arch when a platform preset is requested explicitly', () => {
    expect(parseArgs([])).toEqual({
      platforms: [process.platform],
      explicitPlatform: false,
    });
    expect(archesForPlatform(process.platform, { explicitPlatform: false })).toEqual([process.arch]);

    expect(parseArgs(['--platform=mac'])).toEqual({
      platforms: ['darwin'],
      explicitPlatform: true,
    });
    expect(archesForPlatform('darwin', { explicitPlatform: true })).toEqual(['x64', 'arm64']);
    expect(archesForPlatform('linux', { explicitPlatform: true })).toEqual(['x64', 'arm64']);
    expect(archesForPlatform('win32', { explicitPlatform: true })).toEqual(['x64']);
  });

  it('packages cc-connect and Codex as platform resources on every Electron target', async () => {
    const builderConfig = parse(await readFile(join(repoRoot, 'electron-builder.yml'), 'utf8')) as Record<string, {
      extraResources?: Array<{ from?: string; to?: string }>;
    }>;

    for (const [target, platformDir] of [
      ['mac', 'darwin-${arch}'],
      ['win', 'win32-${arch}'],
      ['linux', 'linux-${arch}'],
    ] as const) {
      const extraResources = builderConfig[target]?.extraResources ?? [];
      expect(extraResources, `${target} should package cc-connect`).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: `build/cc-connect/${platformDir}/`, to: 'cc-connect/' }),
      ]));
      expect(extraResources, `${target} should package Codex`).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: `build/codex/${platformDir}/`, to: 'codex/' }),
      ]));
    }
  });
});
