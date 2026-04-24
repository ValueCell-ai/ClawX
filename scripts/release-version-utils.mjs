const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/;

const SUPPORTED_RELEASE_TYPES = new Set(['patch', 'minor', 'major', 'prerelease']);

export function parseVersion(version) {
  const match = SEMVER_RE.exec(version);
  if (!match) {
    throw new Error(
      `Unsupported version format: ${version}. Expected X.Y.Z or X.Y.Z-preid.N.`,
    );
  }

  const [, major, minor, patch, prereleaseId, prereleaseNumber] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseId
      ? {
          id: prereleaseId,
          number: Number(prereleaseNumber),
        }
      : null,
  };
}

export function formatVersion(parsedVersion) {
  const base = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`;
  if (!parsedVersion.prerelease) {
    return base;
  }

  return `${base}-${parsedVersion.prerelease.id}.${parsedVersion.prerelease.number}`;
}

function assertSupportedReleaseType(releaseType) {
  if (!SUPPORTED_RELEASE_TYPES.has(releaseType)) {
    throw new Error(
      `Unsupported release type: ${releaseType}. Use one of ${Array.from(
        SUPPORTED_RELEASE_TYPES,
      ).join(', ')}.`,
    );
  }
}

export function incrementVersion(version, releaseType, preid = 'alpha') {
  assertSupportedReleaseType(releaseType);
  const parsedVersion = parseVersion(version);

  switch (releaseType) {
    case 'patch':
      return formatVersion({
        major: parsedVersion.major,
        minor: parsedVersion.minor,
        patch: parsedVersion.patch + 1,
        prerelease: null,
      });
    case 'minor':
      return formatVersion({
        major: parsedVersion.major,
        minor: parsedVersion.minor + 1,
        patch: 0,
        prerelease: null,
      });
    case 'major':
      return formatVersion({
        major: parsedVersion.major + 1,
        minor: 0,
        patch: 0,
        prerelease: null,
      });
    case 'prerelease':
      if (!parsedVersion.prerelease) {
        return formatVersion({
          major: parsedVersion.major,
          minor: parsedVersion.minor,
          patch: parsedVersion.patch + 1,
          prerelease: {
            id: preid,
            number: 0,
          },
        });
      }

      if (parsedVersion.prerelease.id === preid) {
        return formatVersion({
          ...parsedVersion,
          prerelease: {
            id: preid,
            number: parsedVersion.prerelease.number + 1,
          },
        });
      }

      return formatVersion({
        major: parsedVersion.major,
        minor: parsedVersion.minor,
        patch: parsedVersion.patch,
        prerelease: {
          id: preid,
          number: 0,
        },
      });
    default:
      throw new Error(`Unhandled release type: ${releaseType}`);
  }
}

function incrementOccupiedCandidate(version, releaseType, preid) {
  if (releaseType !== 'prerelease') {
    return incrementVersion(version, releaseType, preid);
  }

  const parsedVersion = parseVersion(version);
  if (!parsedVersion.prerelease || parsedVersion.prerelease.id !== preid) {
    return incrementVersion(version, releaseType, preid);
  }

  return formatVersion({
    ...parsedVersion,
    prerelease: {
      id: preid,
      number: parsedVersion.prerelease.number + 1,
    },
  });
}

export function resolveAvailableVersion({
  currentVersion,
  releaseType,
  preid = 'alpha',
  hasTag,
}) {
  if (typeof hasTag !== 'function') {
    throw new Error('resolveAvailableVersion requires a synchronous hasTag(version) function.');
  }

  const initialVersion = incrementVersion(currentVersion, releaseType, preid);
  const skippedVersions = [];
  let version = initialVersion;

  while (hasTag(version)) {
    skippedVersions.push(version);
    version = incrementOccupiedCandidate(version, releaseType, preid);
  }

  return {
    initialVersion,
    skippedVersions,
    version,
  };
}

export function nextAvailableVersion(options) {
  return resolveAvailableVersion(options).version;
}
