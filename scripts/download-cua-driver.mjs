#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { arch as currentArch, platform as currentPlatform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import tar from 'tar';

import {
  CUA_DRIVER_TARGETS,
  CUA_DRIVER_VERSION,
  resolveCuaDriverArtifact,
} from './cua-driver-artifacts.mjs';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_BASE = join(ROOT_DIR, 'resources', 'bin');
const PLATFORM_GROUPS = Object.freeze({
  mac: ['darwin-x64', 'darwin-arm64'],
  win: ['win32-x64'],
});

export function selectCuaDriverTargets(args, platform = currentPlatform(), arch = currentArch()) {
  if (args.includes('--all')) {
    return [...CUA_DRIVER_TARGETS];
  }

  const platformOption = args.find((arg) => arg.startsWith('--platform='));
  if (platformOption) {
    const requestedPlatform = platformOption.slice('--platform='.length);
    const targets = PLATFORM_GROUPS[requestedPlatform];
    if (!targets) {
      throw new Error(
        `Unknown platform: ${requestedPlatform}. Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`,
      );
    }
    return [...targets];
  }

  if (platform === 'darwin') return [...PLATFORM_GROUPS.mac];
  if (platform === 'win32' && arch === 'x64') return [...PLATFORM_GROUPS.win];
  return [];
}

async function extractDriver(archive, artifact, extractionDir) {
  if (artifact.archiveType === 'zip') {
    const zip = await JSZip.loadAsync(archive);
    const entry = zip.file(artifact.archiveEntry);
    if (!entry || entry.dir) {
      throw new Error(`Could not find ${artifact.archiveEntry} in ${artifact.asset}`);
    }

    const extractedPath = join(extractionDir, artifact.binName);
    await writeFile(extractedPath, await entry.async('nodebuffer'));
    return extractedPath;
  }

  if (artifact.archiveType === 'tar.gz') {
    const archivePath = join(extractionDir, 'cua-driver.tar.gz');
    await writeFile(archivePath, archive);
    await tar.extract(
      {
        cwd: extractionDir,
        file: archivePath,
        preservePaths: false,
        strict: true,
      },
      [artifact.archiveEntry],
    );
    return join(extractionDir, artifact.archiveEntry);
  }

  throw new Error(`Unsupported CUA driver archive type: ${artifact.archiveType}`);
}

export async function installCuaDriverArtifact(target, options = {}) {
  const artifact = options.artifact ?? resolveCuaDriverArtifact(target);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const outputBase = options.outputBase ?? DEFAULT_OUTPUT_BASE;
  const response = await fetchImpl(artifact.url);

  if (!response.ok) {
    throw new Error(`Failed to download ${artifact.asset}: ${response.status} ${response.statusText}`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(archive).digest('hex');
  if (actualSha256 !== artifact.sha256) {
    throw new Error(
      `SHA256 mismatch for ${artifact.asset}: expected ${artifact.sha256}, received ${actualSha256}`,
    );
  }

  const extractionDir = await mkdtemp(join(tmpdir(), 'clawx-cua-driver-'));
  const targetDir = join(outputBase, target);
  const destination = join(targetDir, artifact.binName);
  const temporaryDestination = `${destination}.${process.pid}.tmp`;

  try {
    const extractedDriver = await extractDriver(archive, artifact, extractionDir);
    await mkdir(targetDir, { recursive: true });
    await copyFile(extractedDriver, temporaryDestination);
    if (!target.startsWith('win32-')) {
      await chmod(temporaryDestination, 0o755);
    }

    await rm(destination, { force: true });
    await rename(temporaryDestination, destination);
    return destination;
  } finally {
    await rm(temporaryDestination, { force: true });
    await rm(extractionDir, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const targets = selectCuaDriverTargets(args);
  if (targets.length === 0) {
    console.log('CUA Driver is not supported on this platform; skipping download');
    return;
  }
  console.log(`Downloading CUA Driver ${CUA_DRIVER_VERSION} for ${targets.join(', ')}`);

  for (const target of targets) {
    const destination = await installCuaDriverArtifact(target);
    console.log(`Installed ${target}: ${destination}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
