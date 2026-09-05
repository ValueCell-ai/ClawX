// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

type AfterPackTestHooks = {
  cleanupNativePlatformPackages: (nodeModulesDir: string, platform: string, arch: string) => number;
  cleanupNodeModulesRuntimeJunk: (nodeModulesDir: string, platform: string, arch: string) => number;
  assertCuaPackagedRuntime: (resourcesDir: string, platform: string, arch: string) => void;
};

const afterPack = require('../../scripts/after-pack.cjs') as { __test?: AfterPackTestHooks };

describe('after-pack cleanup helpers', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempNodeModules(): string {
    const root = mkdtempSync(join(tmpdir(), 'clawx-after-pack-'));
    tempRoots.push(root);
    const nodeModules = join(root, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    return nodeModules;
  }

  function makeTempResources(): string {
    const root = mkdtempSync(join(tmpdir(), 'clawx-after-pack-resources-'));
    tempRoots.push(root);
    return root;
  }

  function makePackage(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}\n', 'utf8');
  }

  it('keeps both mac Codex native packages for universal builds', () => {
    const nodeModules = makeTempNodeModules();
    makePackage(join(nodeModules, '@openai', 'codex-darwin-arm64'));
    makePackage(join(nodeModules, '@openai', 'codex-darwin-x64'));
    makePackage(join(nodeModules, '@openai', 'codex-linux-x64'));

    afterPack.__test!.cleanupNativePlatformPackages(nodeModules, 'darwin', 'universal');

    expect(existsSync(join(nodeModules, '@openai', 'codex-darwin-arm64'))).toBe(true);
    expect(existsSync(join(nodeModules, '@openai', 'codex-darwin-x64'))).toBe(true);
    expect(existsSync(join(nodeModules, '@openai', 'codex-linux-x64'))).toBe(false);
  });

  it('keeps both mac tree-sitter-bash prebuilds for universal builds', () => {
    const nodeModules = makeTempNodeModules();
    const prebuilds = join(nodeModules, 'tree-sitter-bash', 'prebuilds');
    mkdirSync(join(prebuilds, 'darwin-arm64'), { recursive: true });
    mkdirSync(join(prebuilds, 'darwin-x64'), { recursive: true });
    mkdirSync(join(prebuilds, 'linux-x64'), { recursive: true });

    afterPack.__test!.cleanupNodeModulesRuntimeJunk(nodeModules, 'darwin', 'universal');

    expect(existsSync(join(prebuilds, 'darwin-arm64'))).toBe(true);
    expect(existsSync(join(prebuilds, 'darwin-x64'))).toBe(true);
    expect(existsSync(join(prebuilds, 'linux-x64'))).toBe(false);
  });

  it('requires the CUA executable and matching unpacked native SDK in supported packages', () => {
    const resourcesDir = makeTempResources();
    const nativeDir = join(
      resourcesDir,
      'app.asar.unpacked',
      'node_modules',
      '@trycua',
      'cua-driver-darwin-arm64',
    );
    mkdirSync(join(resourcesDir, 'bin'), { recursive: true });
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(resourcesDir, 'bin', 'cua-driver'), 'driver');
    chmodSync(join(resourcesDir, 'bin', 'cua-driver'), 0o755);
    writeFileSync(join(nativeDir, 'cua_driver_node_runtime.node'), 'native');
    writeFileSync(join(nativeDir, 'libcua_driver_sdk.dylib'), 'native');

    expect(() => afterPack.__test!.assertCuaPackagedRuntime(resourcesDir, 'darwin', 'arm64')).not.toThrow();
    rmSync(join(nativeDir, 'libcua_driver_sdk.dylib'));
    expect(() => afterPack.__test!.assertCuaPackagedRuntime(resourcesDir, 'darwin', 'arm64')).toThrow(
      /native SDK/i,
    );
  });
});
