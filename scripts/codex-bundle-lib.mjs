import os from 'node:os';

export const CODEX_VERSION_FALLBACK = '0.137.0';

const TARGETS = {
  'darwin-x64': {
    nodePlatform: 'darwin',
    nodeArch: 'x64',
    packageSuffix: 'darwin-x64',
    targetTriple: 'x86_64-apple-darwin',
    binaryName: 'codex',
  },
  'darwin-arm64': {
    nodePlatform: 'darwin',
    nodeArch: 'arm64',
    packageSuffix: 'darwin-arm64',
    targetTriple: 'aarch64-apple-darwin',
    binaryName: 'codex',
  },
  'linux-x64': {
    nodePlatform: 'linux',
    nodeArch: 'x64',
    packageSuffix: 'linux-x64',
    targetTriple: 'x86_64-unknown-linux-musl',
    binaryName: 'codex',
  },
  'linux-arm64': {
    nodePlatform: 'linux',
    nodeArch: 'arm64',
    packageSuffix: 'linux-arm64',
    targetTriple: 'aarch64-unknown-linux-musl',
    binaryName: 'codex',
  },
  'win32-x64': {
    nodePlatform: 'win32',
    nodeArch: 'x64',
    packageSuffix: 'win32-x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    binaryName: 'codex.exe',
  },
  'win32-arm64': {
    nodePlatform: 'win32',
    nodeArch: 'arm64',
    packageSuffix: 'win32-arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
    binaryName: 'codex.exe',
  },
};

const PRESETS = {
  current: [{ nodePlatform: process.platform, nodeArch: process.arch }],
  mac: [
    { nodePlatform: 'darwin', nodeArch: 'x64' },
    { nodePlatform: 'darwin', nodeArch: 'arm64' },
  ],
  win: [
    { nodePlatform: 'win32', nodeArch: 'x64' },
    { nodePlatform: 'win32', nodeArch: 'arm64' },
  ],
  linux: [
    { nodePlatform: 'linux', nodeArch: 'x64' },
    { nodePlatform: 'linux', nodeArch: 'arm64' },
  ],
  all: [
    { nodePlatform: 'darwin', nodeArch: 'x64' },
    { nodePlatform: 'darwin', nodeArch: 'arm64' },
    { nodePlatform: 'linux', nodeArch: 'x64' },
    { nodePlatform: 'linux', nodeArch: 'arm64' },
    { nodePlatform: 'win32', nodeArch: 'x64' },
    { nodePlatform: 'win32', nodeArch: 'arm64' },
  ],
};

export function normalizeCodexTarget(nodePlatform = os.platform(), nodeArch = os.arch()) {
  const target = TARGETS[`${nodePlatform}-${nodeArch}`];
  if (!target) {
    throw new Error(`Unsupported Codex target: ${nodePlatform}-${nodeArch}`);
  }
  return target;
}

export function parseCodexBundleArgs(argv = process.argv.slice(2)) {
  let preset = 'current';
  for (const arg of argv) {
    if (arg === '--all') preset = 'all';
    else if (arg.startsWith('--platform=')) preset = arg.slice('--platform='.length);
  }
  const targets = PRESETS[preset];
  if (!targets) {
    throw new Error(`Unsupported Codex bundle preset: ${preset}`);
  }
  return { preset, targets };
}

export function getCodexNativePackageName(packageSuffix, version = CODEX_VERSION_FALLBACK) {
  return `@openai/codex@${version}-${packageSuffix}`;
}

export function buildCodexNativeTarballName(version, packageSuffix) {
  return `codex-${version}-${packageSuffix}.tgz`;
}

export function getCodexNativeTarballUrl(version, packageSuffix) {
  return `https://registry.npmjs.org/@openai/codex/-/${buildCodexNativeTarballName(version, packageSuffix)}`;
}

export function buildCodexArchiveExtractionCommand(archivePath, outputDir) {
  return { command: 'tar', args: ['-xzf', archivePath, '-C', outputDir] };
}

export function buildCodexVersionCommand(binaryPath) {
  return { command: binaryPath, args: ['--version'] };
}
