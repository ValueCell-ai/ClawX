// Release commit: 45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f.
export const CUA_DRIVER_VERSION = '0.25.0';
export const CUA_DRIVER_RELEASE_TAG = `cua-driver-rs-v${CUA_DRIVER_VERSION}`;

const RELEASE_BASE_URL = `https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}`;

const MAC_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
  archiveType: 'tar.gz',
  archiveEntry: 'cua-driver',
  binName: 'cua-driver',
  sha256: '29984f5363c12d9901588e814a3a519b8015a1255d7a59d658fbf2d3e51f8983',
});

const WINDOWS_X64_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
  archiveType: 'zip',
  archiveEntry: 'cua-driver.exe',
  binName: 'cua-driver.exe',
  sha256: '314f5df05933810499deaa61022c714341aff64f8e45157a589df6a4b1724fa4',
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
