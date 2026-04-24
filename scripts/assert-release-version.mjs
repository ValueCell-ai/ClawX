#!/usr/bin/env node
/**
 * npm/pnpm `version` lifecycle hook: runs after package.json is bumped, before
 * `git tag`. Aborts if the target tag already exists locally or on origin so
 * we never fail late during tagging or tag push.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackageVersion() {
  const raw = readFileSync(join(root, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

const version = process.env.npm_package_version || readPackageVersion();
const tag = `v${version}`;

function localTagExists(t) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${t}`], {
      cwd: root,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
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

function remoteTagExists(t) {
  if (!originRemoteExists()) {
    return false;
  }

  try {
    const output = execFileSync('git', ['ls-remote', '--tags', 'origin', t, `${t}^{}`], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    return output.length > 0;
  } catch (error) {
    console.error(
      `Release version check failed: unable to query origin tags for ${t}.\n` +
        `Resolve network/auth issues and retry.\n`,
    );
    if (error.stderr) {
      process.stderr.write(String(error.stderr));
    }
    process.exit(1);
  }
}

const existsLocally = localTagExists(tag);
const existsOnOrigin = remoteTagExists(tag);

if (existsLocally || existsOnOrigin) {
  const locations = [
    existsLocally ? 'locally' : null,
    existsOnOrigin ? 'on origin' : null,
  ]
    .filter(Boolean)
    .join(' and ');

  console.error(`
Release version check failed: git tag ${tag} already exists ${locations}.

You cannot run \`pnpm version …\` for ${version} until that tag is gone or the
version is bumped to a value that does not yet have a tag.

Typical fixes:
  • Use the auto-bump wrapper, e.g. \`pnpm run version:auto -- prerelease --preid=alpha\`
  • Or set an explicit free version, e.g. \`pnpm version 0.3.12-alpha.1\`
  • Delete the tag only if you are sure it was created by mistake
`);
  process.exit(1);
}

console.log(`Release version OK: tag ${tag} is not present locally or on origin yet.`);
