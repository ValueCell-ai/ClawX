import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { __test__ } = require('../../scripts/after-pack.cjs');

const cleanupNodeLlamaPackages: (
  nodeModulesDir: string,
  platform: string,
  arch: string,
) => { removed: number; kept: number; mode: string; targetCpu: string | null } =
  __test__.cleanupNodeLlamaPackages;

function writeLlamaPackages(nodeModulesDir: string, names: string[]) {
  const scopeDir = path.join(nodeModulesDir, '@node-llama-cpp');
  fs.mkdirSync(scopeDir, { recursive: true });
  for (const name of names) {
    const pkgDir = path.join(scopeDir, name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.js'), '// stub\n', 'utf8');
  }
}

function readLlamaPackages(nodeModulesDir: string) {
  const scopeDir = path.join(nodeModulesDir, '@node-llama-cpp');
  if (!fs.existsSync(scopeDir)) return [];
  return fs.readdirSync(scopeDir).sort();
}

describe('after-pack node-llama pruning', () => {
  let tmpRoot = '';
  let nodeModulesDir = '';
  const originalGpuEnv = process.env.CLAWX_KEEP_LLAMA_GPU;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'));
    nodeModulesDir = path.join(tmpRoot, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    delete process.env.CLAWX_KEEP_LLAMA_GPU;
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
    if (originalGpuEnv === undefined) {
      delete process.env.CLAWX_KEEP_LLAMA_GPU;
    } else {
      process.env.CLAWX_KEEP_LLAMA_GPU = originalGpuEnv;
    }
  });

  it('keeps only baseline CPU variant in default mode', () => {
    writeLlamaPackages(nodeModulesDir, [
      'win-x64',
      'win-x64-cuda',
      'win-x64-cuda-ext',
      'win-x64-vulkan',
      'win-arm64',
      'linux-x64',
    ]);

    const result = cleanupNodeLlamaPackages(nodeModulesDir, 'win32', 'x64');

    expect(result.mode).toBe('cpu-only');
    expect(result.removed).toBe(5);
    expect(readLlamaPackages(nodeModulesDir)).toEqual(['win-x64']);
  });

  it('keeps same-platform GPU variants when CLAWX_KEEP_LLAMA_GPU=1', () => {
    process.env.CLAWX_KEEP_LLAMA_GPU = '1';
    writeLlamaPackages(nodeModulesDir, [
      'win-x64',
      'win-x64-cuda',
      'win-x64-cuda-ext',
      'win-x64-vulkan',
      'win-arm64',
      'linux-x64',
    ]);

    const result = cleanupNodeLlamaPackages(nodeModulesDir, 'win32', 'x64');

    expect(result.mode).toBe('same-arch-with-gpu');
    expect(readLlamaPackages(nodeModulesDir)).toEqual([
      'win-x64',
      'win-x64-cuda',
      'win-x64-cuda-ext',
      'win-x64-vulkan',
    ]);
  });

  it('skips pruning when target platform variants are absent', () => {
    writeLlamaPackages(nodeModulesDir, [
      'linux-x64',
      'linux-x64-cuda',
      'linux-arm64',
    ]);

    const result = cleanupNodeLlamaPackages(nodeModulesDir, 'win32', 'arm64');

    expect(result.mode).toBe('skip-no-target');
    expect(result.removed).toBe(0);
    expect(readLlamaPackages(nodeModulesDir)).toEqual([
      'linux-arm64',
      'linux-x64',
      'linux-x64-cuda',
    ]);
  });
});
