#!/usr/bin/env node
/**
 * CI / global release sanity: when building from a version tag, the root
 * package.json "version" must match the tag (without the leading "v").
 *
 * Exits 0 when GITHUB_REF is not refs/tags/v* (e.g. branch builds, PRs).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.env.GITHUB_REF || '';

if (!ref.startsWith('refs/tags/v')) {
  console.log(
    `[assert-tag-matches-package] Skip: GITHUB_REF is not a version tag (${ref || '(empty)'})`,
  );
  process.exit(0);
}

const tagVersion = ref.slice('refs/tags/v'.length);
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

if (tagVersion !== pkgVersion) {
  console.error(
    `[assert-tag-matches-package] Mismatch: git tag is "${tagVersion}" but package.json version is "${pkgVersion}".`,
  );
  console.error(
    'Push a commit that sets package.json "version" to match the tag before cutting the release.',
  );
  process.exit(1);
}

console.log(`[assert-tag-matches-package] OK: tag v${tagVersion} matches package.json.`);
