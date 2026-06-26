import os from 'node:os';

export const CC_CONNECT_VERSION_FALLBACK = '1.3.2';

const PLATFORM_MAP = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_MAP = {
  x64: 'amd64',
  arm64: 'arm64',
};

const PRESETS = {
  current: [{ nodePlatform: process.platform, nodeArch: process.arch }],
  mac: [
    { nodePlatform: 'darwin', nodeArch: 'x64' },
    { nodePlatform: 'darwin', nodeArch: 'arm64' },
  ],
  win: [{ nodePlatform: 'win32', nodeArch: 'x64' }],
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
  ],
};

export function normalizeCcConnectTarget(nodePlatform = os.platform(), nodeArch = os.arch()) {
  const platform = PLATFORM_MAP[nodePlatform];
  const arch = ARCH_MAP[nodeArch];
  if (!platform || !arch) {
    throw new Error(`Unsupported cc-connect target: ${nodePlatform}-${nodeArch}`);
  }
  return { platform, arch };
}

export function buildCcConnectAssetName(version, target) {
  const ext = target.platform === 'windows' ? '.zip' : '.tar.gz';
  return `cc-connect-v${version}-${target.platform}-${target.arch}${ext}`;
}

export function parseCcConnectBundleArgs(argv = process.argv.slice(2)) {
  let preset = 'current';
  for (const arg of argv) {
    if (arg === '--all') preset = 'all';
    else if (arg.startsWith('--platform=')) preset = arg.slice('--platform='.length);
  }
  const targets = PRESETS[preset];
  if (!targets) {
    throw new Error(`Unsupported cc-connect bundle preset: ${preset}`);
  }
  return { preset, targets };
}

export function getCcConnectDownloadUrls(version, assetName) {
  return [
    `https://github.com/chenhg5/cc-connect/releases/download/v${version}/${assetName}`,
    `https://gitee.com/cg33/cc-connect/releases/download/v${version}/${assetName}`,
  ];
}
