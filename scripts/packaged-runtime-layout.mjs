import path from 'node:path';

export function defaultPackagedAppPath({ rootDir, platform = process.platform, arch = process.arch }) {
  if (!rootDir) throw new Error('rootDir is required');
  if (platform === 'darwin') {
    return path.join(rootDir, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'ClawX.app');
  }
  if (platform === 'win32') return path.join(rootDir, 'release', 'win-unpacked');
  if (platform === 'linux') {
    return path.join(rootDir, 'release', arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked');
  }
  throw new Error(`Unsupported packaged smoke platform: ${platform}`);
}

export function packagedExecutablePath(appPath, platform = process.platform) {
  if (platform === 'darwin') return path.join(appPath, 'Contents', 'MacOS', 'ClawX');
  if (platform === 'win32') return path.join(appPath, 'ClawX.exe');
  if (platform === 'linux') return path.join(appPath, 'clawx');
  throw new Error(`Unsupported packaged smoke platform: ${platform}`);
}

export function packagedResourcesPath(appPath, platform = process.platform) {
  if (platform === 'darwin') return path.join(appPath, 'Contents', 'Resources');
  if (platform === 'win32' || platform === 'linux') return path.join(appPath, 'resources');
  throw new Error(`Unsupported packaged smoke platform: ${platform}`);
}

export function shouldVerifyPackagedCodeSignature(platform = process.platform, allowUnsigned = false) {
  return platform === 'darwin' && !allowUnsigned;
}
