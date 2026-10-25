// Release commit: 2d2f99228d4d2508dc6fcc84c176b296e146714a.
export const CUA_DRIVER_VERSION = '0.37.0';
export const CUA_DRIVER_RELEASE_TAG = `cua-driver-rs-v${CUA_DRIVER_VERSION}`;

const RELEASE_BASE_URL = `https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}`;

const MAC_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
  archiveType: 'tar.gz',
  archiveEntry: 'cua-driver',
  binName: 'cua-driver',
  sha256: '7d491f67f54be5f3b380ffd85c64b242eaefd05dad6df78012cde227c95aee2a',
});

const WINDOWS_X64_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
  archiveType: 'zip',
  archiveEntry: 'cua-driver.exe',
  binName: 'cua-driver.exe',
  sha256: '40481b55073f1225b0010235b30217bd640ef1f323e982aec0a5f6131d3e4a99',
});

const ARTIFACTS = Object.freeze({
  'darwin-x64': MAC_ARTIFACT,
  'darwin-arm64': MAC_ARTIFACT,
  'win32-x64': WINDOWS_X64_ARTIFACT,
});

export const CUA_DRIVER_TARGETS = Object.freeze(Object.keys(ARTIFACTS));

export function resolveCuaDriverArtifact(target) {
  const artifact = ARTIFACTS[target];
  if (!artifact) {
    throw new Error(`Unsupported CUA driver target: ${target}`);
  }

  return {
    ...artifact,
    url: `${RELEASE_BASE_URL}/${artifact.asset}`,
  };
}
