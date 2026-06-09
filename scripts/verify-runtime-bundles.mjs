#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const platforms = new Set();
  for (const arg of argv) {
    if (arg === '--all') {
      platforms.add('darwin');
      platforms.add('win32');
      platforms.add('linux');
      continue;
    }
    const match = arg.match(/^--platform=(.+)$/);
    if (match) {
      const value = match[1];
      if (value === 'mac') platforms.add('darwin');
      else if (value === 'win') platforms.add('win32');
      else if (value === 'linux') platforms.add('linux');
      else platforms.add(value);
    }
  }
  if (platforms.size === 0) platforms.add(process.platform);
  return Array.from(platforms);
}

function archesForPlatform(platform) {
  if (platform === process.platform) return [process.arch];
  if (platform === 'darwin') return ['x64', 'arm64'];
  if (platform === 'linux') return ['x64', 'arm64'];
  if (platform === 'win32') return ['x64'];
  throw new Error(`Unsupported runtime bundle platform: ${platform}`);
}

function binaryName(platform, base) {
  return platform === 'win32' ? `${base}.exe` : base;
}

function checkPath(required, missing) {
  if (!fs.existsSync(required.path)) missing.push(required);
}

const missing = [];
for (const platform of parseArgs(process.argv.slice(2))) {
  for (const arch of archesForPlatform(platform)) {
    const target = `${platform}-${arch}`;
    checkPath({
      label: `cc-connect binary (${target})`,
      path: path.join(root, 'build', 'cc-connect', target, binaryName(platform, 'cc-connect')),
      fix: platform === process.platform && arch === process.arch
        ? 'pnpm run bundle:cc-connect:current'
        : `pnpm run bundle:cc-connect:${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}`,
    }, missing);
    checkPath({
      label: `Codex binary (${target})`,
      path: path.join(root, 'build', 'codex', target, 'bin', binaryName(platform, 'codex')),
      fix: platform === process.platform && arch === process.arch
        ? 'pnpm run bundle:codex:current'
        : `pnpm run bundle:codex:${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}`,
    }, missing);
  }
}

if (missing.length > 0) {
  console.error('Missing bundled runtime artifact(s):');
  for (const item of missing) {
    console.error(`- ${item.label}: ${item.path}`);
    console.error(`  Fix: ${item.fix}`);
  }
  process.exit(1);
}

console.log('Runtime bundle verification passed.');
