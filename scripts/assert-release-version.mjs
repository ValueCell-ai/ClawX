#!/usr/bin/env node
/**
 * npm/pnpm `version` lifecycle hook: runs after package.json is bumped, before
 * `git tag`. Aborts if the target tag already exists so we never fail late on
 * `fatal: tag 'vX.Y.Z' already exists`.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
    execSync(`git rev-parse -q --verify refs/tags/${t}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (localTagExists(tag)) {
  console.error(`
Release version check failed: git tag ${tag} already exists locally.

You cannot run \`pnpm version …\` for ${version} until that tag is gone or the
version is bumped to a value that does not yet have a tag.

Typical fixes:
  • Use the next prerelease explicitly, e.g. \`pnpm version 0.3.10-beta.4\`
  • Or delete only if you are sure it was created by mistake: \`git tag -d ${tag}\`
`);
  process.exit(1);
}

console.log(`Release version OK: tag ${tag} is not present locally yet.`);
