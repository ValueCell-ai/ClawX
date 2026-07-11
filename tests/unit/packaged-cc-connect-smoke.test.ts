// @vitest-environment node
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  defaultPackagedAppPath,
  packagedExecutablePath,
  packagedResourcesPath,
} from '../../scripts/packaged-runtime-layout.mjs';

describe('packaged cc-connect smoke paths', () => {
  const rootDir = join('repo', 'clawx');

  it.each([
    ['darwin', 'arm64', join(rootDir, 'release', 'mac-arm64', 'ClawX.app')],
    ['darwin', 'x64', join(rootDir, 'release', 'mac', 'ClawX.app')],
    ['win32', 'x64', join(rootDir, 'release', 'win-unpacked')],
    ['linux', 'x64', join(rootDir, 'release', 'linux-unpacked')],
    ['linux', 'arm64', join(rootDir, 'release', 'linux-arm64-unpacked')],
  ] as const)('resolves the %s-%s output', (platform, arch, expected) => {
    expect(defaultPackagedAppPath({ platform, arch, rootDir })).toBe(expected);
  });

  it('resolves native executable and resource paths', () => {
    expect(packagedExecutablePath('/app/ClawX.app', 'darwin')).toBe('/app/ClawX.app/Contents/MacOS/ClawX');
    expect(packagedResourcesPath('/app/ClawX.app', 'darwin')).toBe('/app/ClawX.app/Contents/Resources');
    expect(packagedExecutablePath('/app/win-unpacked', 'win32')).toBe('/app/win-unpacked/ClawX.exe');
    expect(packagedResourcesPath('/app/win-unpacked', 'win32')).toBe('/app/win-unpacked/resources');
    expect(packagedExecutablePath('/app/linux-unpacked', 'linux')).toBe('/app/linux-unpacked/clawx');
    expect(packagedResourcesPath('/app/linux-unpacked', 'linux')).toBe('/app/linux-unpacked/resources');
  });

  it('rejects unsupported platforms', () => {
    expect(() => defaultPackagedAppPath({ platform: 'freebsd', arch: 'x64', rootDir })).toThrow('Unsupported packaged smoke platform');
    expect(() => packagedExecutablePath('/app', 'freebsd')).toThrow('Unsupported packaged smoke platform');
    expect(() => packagedResourcesPath('/app', 'freebsd')).toThrow('Unsupported packaged smoke platform');
  });

  it('keeps the Windows residual-process PowerShell command syntactically separated', async () => {
    const source = await readFile(join(process.cwd(), 'scripts', 'smoke-packaged-cc-connect.mjs'), 'utf8');
    expect(source).toContain("'$needle = $env:CLAWX_SMOKE_PROCESS_NEEDLE;'");
    expect(source).toContain("execFileAsync('powershell.exe'");
  });
});
