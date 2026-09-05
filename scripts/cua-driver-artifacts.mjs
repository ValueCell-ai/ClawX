export const CUA_DRIVER_VERSION = '0.21.0';
export const CUA_DRIVER_RELEASE_TAG = `cua-driver-rs-v${CUA_DRIVER_VERSION}`;

const RELEASE_BASE_URL = `https://github.com/trycua/cua/releases/download/${CUA_DRIVER_RELEASE_TAG}`;

const MAC_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
  archiveType: 'tar.gz',
  archiveEntry: 'cua-driver',
  binName: 'cua-driver',
  sha256: '5e327e58f6ce81d5c117fe5edec5f267e87e1b921e8c5a8aa4f7f21cbcf5f273',
});

const WINDOWS_X64_ARTIFACT = Object.freeze({
  asset: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
  archiveType: 'zip',
  archiveEntry: 'cua-driver.exe',
  binName: 'cua-driver.exe',
  sha256: 'd63f6a78e65afc06524048f5557fed36cdf01f0a8a680236e93c9a2fb3587f44',
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
