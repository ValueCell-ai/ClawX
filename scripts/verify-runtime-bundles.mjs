#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const platforms = new Set();
  let explicitPlatform = false;
  for (const arg of argv) {
    if (arg === '--all') {
      explicitPlatform = true;
      platforms.add('darwin');
      platforms.add('win32');
      platforms.add('linux');
      continue;
    }
    const match = arg.match(/^--platform=(.+)$/);
    if (match) {
      explicitPlatform = true;
      const value = match[1];
      if (value === 'mac') platforms.add('darwin');
      else if (value === 'win') platforms.add('win32');
      else if (value === 'linux') platforms.add('linux');
      else platforms.add(value);
    }
  }
  if (platforms.size === 0) platforms.add(process.platform);
  return { platforms: Array.from(platforms), explicitPlatform };
}

export function archesForPlatform(platform, { explicitPlatform = false } = {}) {
  if (!explicitPlatform && platform === process.platform) return [process.arch];
  if (platform === 'darwin') return ['x64', 'arm64'];
  if (platform === 'linux') return ['x64', 'arm64'];
  if (platform === 'win32') return ['x64'];
  throw new Error(`Unsupported runtime bundle platform: ${platform}`);
}

function binaryName(platform, base) {
  return platform === 'win32' ? `${base}.exe` : base;
}

function packageVersion(name) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const raw = packageJson.devDependencies?.[name] ?? packageJson.dependencies?.[name];
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`Missing pinned package version for ${name}`);
  }
  return raw.replace(/^[^\d]*/, '');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function detectExecutableTarget(buffer) {
  if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0xfeedfacf) {
    const arch = new Map([
      [0x01000007, 'x64'],
      [0x0100000c, 'arm64'],
    ]).get(buffer.readUInt32LE(4));
    return arch ? { platform: 'darwin', arch } : null;
  }
  if (
    buffer.length >= 20 &&
    buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46 &&
    buffer[4] === 2 && buffer[5] === 1
  ) {
    const arch = new Map([
      [62, 'x64'],
      [183, 'arm64'],
    ]).get(buffer.readUInt16LE(18));
    return arch ? { platform: 'linux', arch } : null;
  }
  if (buffer.length >= 64 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (peOffset + 6 <= buffer.length && buffer.toString('ascii', peOffset, peOffset + 4) === 'PE\0\0') {
      const arch = new Map([
        [0x8664, 'x64'],
        [0xaa64, 'arm64'],
      ]).get(buffer.readUInt16LE(peOffset + 4));
      return arch ? { platform: 'win32', arch } : null;
    }
  }
  return null;
}

export function validateRuntimeBundleManifest(required, manifest, binarySha256, binaryMode = 0, binaryBuffer = null) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }
  for (const [field, expected] of Object.entries({
    name: required.name,
    version: required.version,
    nodePlatform: required.nodePlatform,
    nodeArch: required.nodeArch,
    binaryName: required.binaryName,
  })) {
    if (manifest[field] !== expected) {
      issues.push(`${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(manifest[field])}`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')) {
    issues.push('sha256 must be a lowercase 64-character digest');
  } else if (manifest.sha256 !== binarySha256) {
    issues.push(`sha256 mismatch: manifest=${manifest.sha256}, binary=${binarySha256}`);
  }
  if (typeof manifest.verifiedWithVersionCommand !== 'boolean') {
    issues.push('verifiedWithVersionCommand must be boolean');
  } else if (
    required.nodePlatform === process.platform &&
    required.nodeArch === process.arch &&
    !manifest.verifiedWithVersionCommand
  ) {
    issues.push('verifiedWithVersionCommand must be true for the current executable target');
  }
  if (required.nodePlatform !== 'win32' && (binaryMode & 0o111) === 0) {
    issues.push('binary must have an executable bit');
  }
  if (required.name === 'cc-connect') {
    if (typeof manifest.sourceUrl !== 'string' || !/^https:\/\//.test(manifest.sourceUrl)) {
      issues.push('sourceUrl must be an HTTPS URL');
    }
    if (typeof manifest.assetName !== 'string' || !manifest.assetName) {
      issues.push('assetName must be present');
    }
  } else if (required.name === 'codex') {
    if (typeof manifest.packageSuffix !== 'string' || !manifest.packageSuffix) {
      issues.push('packageSuffix must be present');
    }
    if (typeof manifest.targetTriple !== 'string' || !manifest.targetTriple) {
      issues.push('targetTriple must be present');
    }
  }
  if (binaryBuffer) {
    const target = detectExecutableTarget(binaryBuffer);
    if (!target) {
      issues.push('binary header must identify a supported Mach-O, ELF, or PE target');
    } else if (target.platform !== required.nodePlatform || target.arch !== required.nodeArch) {
      issues.push(`binary target must be ${required.nodePlatform}-${required.nodeArch}, got ${target.platform}-${target.arch}`);
    }
  }
  return issues;
}

export function checkPath(required, missing) {
  if (!fs.existsSync(required.path)) missing.push(required);
}

export function collectMissingRuntimeBundles(argv = process.argv.slice(2)) {
  const { platforms, explicitPlatform } = parseArgs(argv);
  const missing = [];
  for (const platform of platforms) {
    for (const arch of archesForPlatform(platform, { explicitPlatform })) {
      const target = `${platform}-${arch}`;
      checkPath({
        label: `cc-connect binary (${target})`,
        path: path.join(root, 'build', 'cc-connect', target, binaryName(platform, 'cc-connect')),
        fix: platform === process.platform && arch === process.arch && !explicitPlatform
          ? 'pnpm run bundle:cc-connect:current'
          : `pnpm run bundle:cc-connect:${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}`,
      }, missing);
      checkPath({
        label: `Codex binary (${target})`,
        path: path.join(root, 'build', 'codex', target, 'bin', binaryName(platform, 'codex')),
        fix: platform === process.platform && arch === process.arch && !explicitPlatform
          ? 'pnpm run bundle:codex:current'
          : `pnpm run bundle:codex:${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}`,
      }, missing);
    }
  }
  return missing;
}

export function collectInvalidRuntimeBundles(argv = process.argv.slice(2)) {
  const { platforms, explicitPlatform } = parseArgs(argv);
  const versions = {
    'cc-connect': packageVersion('cc-connect'),
    codex: packageVersion('@openai/codex'),
  };
  const invalid = [];
  for (const platform of platforms) {
    for (const arch of archesForPlatform(platform, { explicitPlatform })) {
      const target = `${platform}-${arch}`;
      for (const runtime of ['cc-connect', 'codex']) {
        const name = runtime;
        const targetRoot = path.join(root, 'build', runtime, target);
        const expectedBinaryName = binaryName(platform, runtime === 'cc-connect' ? 'cc-connect' : 'codex');
        const binaryPath = runtime === 'codex'
          ? path.join(targetRoot, 'bin', expectedBinaryName)
          : path.join(targetRoot, expectedBinaryName);
        const manifestPath = path.join(targetRoot, 'manifest.json');
        if (!fs.existsSync(binaryPath) || !fs.existsSync(manifestPath)) continue;
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (error) {
          invalid.push({ label: `${runtime} manifest (${target})`, path: manifestPath, issues: [`invalid JSON: ${error.message}`] });
          continue;
        }
        const binaryBuffer = fs.readFileSync(binaryPath);
        const issues = validateRuntimeBundleManifest({
          name,
          version: versions[runtime],
          nodePlatform: platform,
          nodeArch: arch,
          binaryName: expectedBinaryName,
        }, manifest, sha256File(binaryPath), fs.statSync(binaryPath).mode, binaryBuffer);
        if (issues.length > 0) invalid.push({ label: `${runtime} bundle (${target})`, path: targetRoot, issues });
      }
    }
  }
  return invalid;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = collectMissingRuntimeBundles();
  const invalid = collectInvalidRuntimeBundles();

  if (missing.length > 0) {
    console.error('Missing bundled runtime artifact(s):');
    for (const item of missing) {
      console.error(`- ${item.label}: ${item.path}`);
      console.error(`  Fix: ${item.fix}`);
    }
  }

  if (invalid.length > 0) {
    console.error('Invalid bundled runtime artifact(s):');
    for (const item of invalid) {
      console.error(`- ${item.label}: ${item.path}`);
      for (const issue of item.issues) console.error(`  ${issue}`);
    }
  }

  if (missing.length > 0 || invalid.length > 0) process.exit(1);

  console.log('Runtime bundle verification passed.');
}
