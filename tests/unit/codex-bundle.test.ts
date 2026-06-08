// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCodexNativeTarballName,
  getCodexNativePackageName,
  normalizeCodexTarget,
} from '../fixtures/codex-bundle-api';

describe('Codex bundle helpers', () => {
  it('maps Node platform and arch to Codex native package metadata', () => {
    expect(normalizeCodexTarget('darwin', 'arm64')).toEqual({
      nodePlatform: 'darwin',
      nodeArch: 'arm64',
      packageSuffix: 'darwin-arm64',
      targetTriple: 'aarch64-apple-darwin',
      binaryName: 'codex',
    });
    expect(normalizeCodexTarget('linux', 'x64')).toMatchObject({
      packageSuffix: 'linux-x64',
      targetTriple: 'x86_64-unknown-linux-musl',
    });
    expect(normalizeCodexTarget('win32', 'x64')).toMatchObject({
      packageSuffix: 'win32-x64',
      targetTriple: 'x86_64-pc-windows-msvc',
      binaryName: 'codex.exe',
    });
  });

  it('builds npm tarball names for Codex native packages', () => {
    expect(getCodexNativePackageName('darwin-arm64')).toBe('@openai/codex@0.137.0-darwin-arm64');
    expect(buildCodexNativeTarballName('0.137.0', 'linux-x64')).toBe('codex-0.137.0-linux-x64.tgz');
  });
});
