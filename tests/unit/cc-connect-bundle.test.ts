// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildArchiveExtractionCommand,
  buildCcConnectAssetName,
  buildVersionCommand,
  normalizeCcConnectTarget,
  parseCcConnectBundleArgs,
} from '../fixtures/cc-connect-bundle-api';

describe('cc-connect bundle helpers', () => {
  it('maps Node platform and arch to cc-connect release asset names', () => {
    expect(normalizeCcConnectTarget('darwin', 'arm64')).toEqual({ platform: 'darwin', arch: 'arm64' });
    expect(normalizeCcConnectTarget('win32', 'x64')).toEqual({ platform: 'windows', arch: 'amd64' });
    expect(buildCcConnectAssetName('1.3.2', { platform: 'linux', arch: 'amd64' })).toBe('cc-connect-v1.3.2-linux-amd64.tar.gz');
    expect(buildCcConnectAssetName('1.3.2', { platform: 'windows', arch: 'amd64' })).toBe('cc-connect-v1.3.2-windows-amd64.zip');
  });

  it('expands platform bundle presets without relying on runtime downloads', () => {
    expect(parseCcConnectBundleArgs(['--platform=mac']).targets).toEqual([
      { nodePlatform: 'darwin', nodeArch: 'x64' },
      { nodePlatform: 'darwin', nodeArch: 'arm64' },
    ]);
    expect(parseCcConnectBundleArgs(['--all']).targets).toContainEqual({ nodePlatform: 'win32', nodeArch: 'x64' });
  });

  it('passes Windows archive paths as opaque process arguments', () => {
    const archivePath = String.raw`D:\a\ClawX\build\cc-connect\win32-x64\cc-connect.zip`;
    const outputDir = String.raw`D:\a\ClawX\build\cc-connect\win32-x64`;

    expect(buildArchiveExtractionCommand(archivePath, outputDir, true)).toEqual({
      command: 'tar',
      args: ['-xf', archivePath, '-C', outputDir],
    });
    expect(buildVersionCommand(String.raw`D:\a\ClawX\build\cc-connect\cc-connect.exe`)).toEqual({
      command: String.raw`D:\a\ClawX\build\cc-connect\cc-connect.exe`,
      args: ['--version'],
    });
  });
});
