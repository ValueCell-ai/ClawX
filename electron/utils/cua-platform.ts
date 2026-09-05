import { release } from 'node:os';

export function isCuaPlatformSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  osRelease: string = release(),
): boolean {
  if (platform === 'win32') return arch === 'x64';
  if (platform !== 'darwin' || !['x64', 'arm64'].includes(arch)) return false;

  const darwinMajor = Number.parseInt(osRelease.split('.')[0] ?? '', 10);
  return Number.isFinite(darwinMajor) && darwinMajor >= 22;
}
