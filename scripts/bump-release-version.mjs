#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAvailableVersion } from './release-version-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackageVersion() {
  const raw = readFileSync(join(root, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

function originRemoteExists() {
  try {
    execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function localTagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      cwd: root,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag) {
  if (!originRemoteExists()) {
    return false;
  }

  try {
    const output = execFileSync('git', ['ls-remote', '--tags', 'origin', tag, `${tag}^{}`], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return output.length > 0;
  } catch (error) {
    console.error(
      `Unable to query origin tags for ${tag}. Resolve network/auth issues and retry.\n`,
    );
    if (error.stderr) {
      process.stderr.write(String(error.stderr));
    }
    process.exit(1);
  }
}

function printUsageAndExit(message) {
  if (message) {
    console.error(`${message}\n`);
  }
  console.error(
    'Usage: node scripts/bump-release-version.mjs <patch|minor|major|prerelease> ' +
      '[--preid=<alpha|beta|...>] [--dry-run] [extra pnpm version args...]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  const passthroughArgs = [];
  let releaseType = null;
  let preid = 'alpha';
  let dryRun = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (!releaseType && !arg.startsWith('--')) {
      releaseType = arg;
      continue;
    }

    if (arg === '--preid') {
      const value = args.shift();
      if (!value) {
        printUsageAndExit('Missing value for --preid.');
      }
      preid = value;
      continue;
    }

    if (arg.startsWith('--preid=')) {
      preid = arg.slice('--preid='.length);
      if (!preid) {
        printUsageAndExit('Missing value for --preid.');
      }
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    passthroughArgs.push(arg);
  }

  if (!releaseType) {
    printUsageAndExit('Missing release type.');
  }

  return {
    dryRun,
    passthroughArgs,
    preid,
    releaseType,
  };
}

const { dryRun, passthroughArgs, preid, releaseType } = parseArgs(process.argv.slice(2));
const currentVersion = readPackageVersion();

const resolution = resolveAvailableVersion({
  currentVersion,
  releaseType,
  preid,
  hasTag: (candidateVersion) => {
    const tag = `v${candidateVersion}`;
    return localTagExists(tag) || remoteTagExists(tag);
  },
});

if (resolution.skippedVersions.length > 0) {
  console.log(
    `Skipped occupied tags: ${resolution.skippedVersions
      .map((version) => `v${version}`)
      .join(', ')}`,
  );
}

console.log(`Selected release version: ${resolution.version}`);

if (dryRun) {
  process.exit(0);
}

execFileSync('pnpm', ['version', resolution.version, ...passthroughArgs], {
  cwd: root,
  stdio: 'inherit',
});
