// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  archesForPlatform,
  detectExecutableTarget,
  parseArgs,
  validateRuntimeBundleManifest,
} from '../../scripts/verify-runtime-bundles.mjs';
import {
  hashMachOSections,
  parsePackagedResourceArgs,
} from '../../scripts/verify-packaged-runtime-resources.mjs';

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

    const afterPack = await readFile(join(repoRoot, 'scripts/after-pack.cjs'), 'utf8');
    expect(afterPack).toContain("import('./verify-packaged-runtime-resources.mjs')");
    expect(afterPack).toContain('verifyPackagedRuntimeResources({ resources: resourcesDir, platform, arch })');

    const releaseWorkflow = await readFile(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    for (const target of [
      'release/mac/ClawX.app/Contents/Resources --platform=darwin --arch=x64',
      'release/mac-arm64/ClawX.app/Contents/Resources --platform=darwin --arch=arm64',
      'release/win-unpacked/resources --platform=win32 --arch=x64',
      'release/linux-unpacked/resources --platform=linux --arch=x64',
      'release/linux-arm64-unpacked/resources --platform=linux --arch=arm64',
    ]) {
      expect(releaseWorkflow).toContain(`verify:packaged-runtime-resources -- --resources=${target}`);
    }
    expect(releaseWorkflow).toContain('runs-on: macos-15-intel');
    expect(releaseWorkflow).toContain('runs-on: ubuntu-24.04-arm');
    expect(releaseWorkflow.match(/smoke:cc-connect:packaged/g)).toHaveLength(5);
    expect(releaseWorkflow).toContain('artifacts/cc-connect/packaged-smoke-*.json');
    expect(releaseWorkflow).toContain('artifacts/cc-connect/packaged-smoke-darwin-x64.json');
    expect(releaseWorkflow).toContain('artifacts/cc-connect/packaged-smoke-linux-arm64.json');
    expect(releaseWorkflow).toContain('needs: [release, runtime-smoke-macos-x64, runtime-smoke-linux-arm64]');

    const workflow = parse(releaseWorkflow) as {
      jobs?: Record<string, {
        if?: string;
        steps?: Array<{ name?: string; env?: Record<string, string> }>;
      }>;
    };
    expect(workflow.jobs?.publish?.if).toBe("startsWith(github.ref, 'refs/tags/')");
    expect(workflow.jobs?.['upload-oss']?.if).toBe("startsWith(github.ref, 'refs/tags/')");
    const macBuild = workflow.jobs?.release?.steps?.find((step) => step.name === 'Build macOS');
    expect(macBuild?.env?.CSC_IDENTITY_AUTO_DISCOVERY)
      .toBe("${{ github.event_name == 'workflow_dispatch' && 'false' || 'true' }}");
    expect(macBuild?.env?.CSC_LINK)
      .toBe("${{ github.event_name == 'push' && secrets.MAC_CERTS || '' }}");
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

  it('rejects stale, corrupted, and non-executable runtime bundle manifests', () => {
    const required = {
      name: 'cc-connect',
      version: '1.4.1',
      nodePlatform: 'linux',
      nodeArch: 'arm64',
      binaryName: 'cc-connect',
    };
    const valid = {
      ...required,
      sha256: 'a'.repeat(64),
      sourceUrl: 'https://example.test/cc-connect.tar.gz',
      assetName: 'cc-connect.tar.gz',
      verifiedWithVersionCommand: false,
    };

    expect(validateRuntimeBundleManifest(required, valid, 'a'.repeat(64), 0o100755)).toEqual([]);
    expect(validateRuntimeBundleManifest(required, {
      ...valid,
      version: '1.3.2',
      sha256: 'b'.repeat(64),
    }, 'a'.repeat(64), 0o100644)).toEqual(expect.arrayContaining([
      expect.stringContaining('version must be'),
      expect.stringContaining('sha256 mismatch'),
      'binary must have an executable bit',
    ]));
  });

  it('requires Codex package target metadata in its manifest', () => {
    const required = {
      name: 'codex',
      version: '0.137.0',
      nodePlatform: 'win32',
      nodeArch: 'x64',
      binaryName: 'codex.exe',
    };
    expect(validateRuntimeBundleManifest(required, {
      ...required,
      sha256: 'c'.repeat(64),
      verifiedWithVersionCommand: false,
    }, 'c'.repeat(64))).toEqual(expect.arrayContaining([
      'packageSuffix must be present',
      'targetTriple must be present',
    ]));
  });

  it('detects actual Mach-O, ELF, and PE executable targets', () => {
    const macho = Buffer.alloc(8);
    macho.writeUInt32LE(0xfeedfacf, 0);
    macho.writeUInt32LE(0x0100000c, 4);
    expect(detectExecutableTarget(macho)).toEqual({ platform: 'darwin', arch: 'arm64' });

    const elf = Buffer.alloc(20);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    elf.writeUInt16LE(62, 18);
    expect(detectExecutableTarget(elf)).toEqual({ platform: 'linux', arch: 'x64' });

    const pe = Buffer.alloc(72);
    pe.set([0x4d, 0x5a]);
    pe.writeUInt32LE(64, 0x3c);
    pe.write('PE\0\0', 64, 'ascii');
    pe.writeUInt16LE(0x8664, 68);
    expect(detectExecutableTarget(pe)).toEqual({ platform: 'win32', arch: 'x64' });
    expect(detectExecutableTarget(Buffer.from('not executable'))).toBeNull();
  });

  it('rejects executable headers that disagree with the manifest target', () => {
    const binary = Buffer.alloc(20);
    binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    binary.writeUInt16LE(62, 18);
    const required = {
      name: 'cc-connect',
      version: '1.4.1',
      nodePlatform: 'linux',
      nodeArch: 'arm64',
      binaryName: 'cc-connect',
    };
    expect(validateRuntimeBundleManifest(required, {
      ...required,
      sha256: 'd'.repeat(64),
      sourceUrl: 'https://example.test/cc-connect',
      assetName: 'cc-connect',
      verifiedWithVersionCommand: false,
    }, 'd'.repeat(64), 0o100755, binary)).toContain('binary target must be linux-arm64, got linux-x64');
  });

  it('requires an explicit packaged resources target for cross-platform smoke', () => {
    expect(parsePackagedResourceArgs([
      '--resources=release/win-unpacked/resources',
      '--platform=win32',
      '--arch=x64',
    ])).toEqual({
      resources: 'release/win-unpacked/resources',
      platform: 'win32',
      arch: 'x64',
    });
    expect(() => parsePackagedResourceArgs(['--platform=win32'])).toThrow(/Usage:/);
    expect(() => parsePackagedResourceArgs([
      '--resources=release/unknown',
      '--platform=freebsd',
      '--arch=x64',
    ])).toThrow('Unsupported platform: freebsd');
  });

  it('hashes Mach-O section payloads independently of signing load commands', () => {
    const makeMachO = (loadCommandPadding: number, payload: string) => {
      const commandSize = 72 + 80 + loadCommandPadding;
      const sectionFileOffset = 32 + commandSize;
      const payloadBuffer = Buffer.from(payload);
      const buffer = Buffer.alloc(sectionFileOffset + payloadBuffer.length);
      buffer.writeUInt32LE(0xfeedfacf, 0);
      buffer.writeUInt32LE(1, 16);
      buffer.writeUInt32LE(commandSize, 20);
      buffer.writeUInt32LE(0x19, 32);
      buffer.writeUInt32LE(commandSize, 36);
      buffer.write('__TEXT', 40, 'ascii');
      buffer.writeUInt32LE(1, 32 + 64);
      buffer.write('__text', 32 + 72, 'ascii');
      buffer.write('__TEXT', 32 + 72 + 16, 'ascii');
      buffer.writeBigUInt64LE(BigInt(payloadBuffer.length), 32 + 72 + 40);
      buffer.writeUInt32LE(sectionFileOffset, 32 + 72 + 48);
      payloadBuffer.copy(buffer, sectionFileOffset);
      return buffer;
    };

    expect(hashMachOSections(makeMachO(0, 'runtime payload')))
      .toBe(hashMachOSections(makeMachO(16, 'runtime payload')));
    expect(hashMachOSections(makeMachO(0, 'runtime payload')))
      .not.toBe(hashMachOSections(makeMachO(0, 'tampered payload')));
  });
});
