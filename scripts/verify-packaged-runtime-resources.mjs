#!/usr/bin/env node
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeBundleManifest } from './verify-runtime-bundles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parsePackagedResourceArgs(argv) {
  const values = {};
  for (const arg of argv) {
    const match = arg.match(/^--(resources|platform|arch)=(.+)$/);
    if (match) values[match[1]] = match[2];
  }
  if (!values.resources || !values.platform || !values.arch) {
    throw new Error('Usage: verify-packaged-runtime-resources.mjs --resources=<path> --platform=<darwin|win32|linux> --arch=<x64|arm64>');
  }
  if (!['darwin', 'win32', 'linux'].includes(values.platform)) {
    throw new Error(`Unsupported platform: ${values.platform}`);
  }
  if (!['x64', 'arm64'].includes(values.arch)) {
    throw new Error(`Unsupported arch: ${values.arch}`);
  }
  return values;
}

function pinnedVersion(packageName) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const raw = packageJson.devDependencies?.[packageName] ?? packageJson.dependencies?.[packageName];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Missing pinned package version for ${packageName}`);
  return raw.replace(/^[^\d]*/, '');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixedString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString('utf8');
}

export function hashMachOSections(buffer) {
  if (buffer.length < 32 || buffer.readUInt32LE(0) !== 0xfeedfacf) {
    throw new Error('expected a thin little-endian 64-bit Mach-O binary');
  }
  const commandCount = buffer.readUInt32LE(16);
  const commandsSize = buffer.readUInt32LE(20);
  const commandsEnd = 32 + commandsSize;
  if (commandsEnd > buffer.length) throw new Error('Mach-O load commands exceed file size');

  const hash = crypto.createHash('sha256');
  let commandOffset = 32;
  let sectionCount = 0;
  for (let commandIndex = 0; commandIndex < commandCount; commandIndex += 1) {
    if (commandOffset + 8 > commandsEnd) throw new Error('truncated Mach-O load command');
    const command = buffer.readUInt32LE(commandOffset);
    const commandSize = buffer.readUInt32LE(commandOffset + 4);
    if (commandSize < 8 || commandOffset + commandSize > commandsEnd) {
      throw new Error('invalid Mach-O load command size');
    }
    if (command === 0x19) {
      if (commandSize < 72) throw new Error('truncated LC_SEGMENT_64 command');
      const segmentName = fixedString(buffer, commandOffset + 8, 16);
      const segmentSectionCount = buffer.readUInt32LE(commandOffset + 64);
      if (72 + segmentSectionCount * 80 > commandSize) throw new Error('truncated Mach-O section table');
      for (let sectionIndex = 0; sectionIndex < segmentSectionCount; sectionIndex += 1) {
        const sectionOffset = commandOffset + 72 + sectionIndex * 80;
        const sectionName = fixedString(buffer, sectionOffset, 16);
        const sectionSegmentName = fixedString(buffer, sectionOffset + 16, 16);
        const sectionSize = Number(buffer.readBigUInt64LE(sectionOffset + 40));
        if (!Number.isSafeInteger(sectionSize)) throw new Error(`Mach-O section ${sectionName} size is not a safe integer`);
        const fileOffset = buffer.readUInt32LE(sectionOffset + 48);
        const flags = buffer.readUInt32LE(sectionOffset + 64);
        const sectionType = flags & 0xff;
        const zeroFill = sectionType === 0x1 || sectionType === 0xc || sectionType === 0x12;
        hash.update(`${segmentName}\0${sectionSegmentName}\0${sectionName}\0${sectionSize}\0${flags}\0`);
        if (!zeroFill) {
          if (fileOffset + sectionSize > buffer.length) throw new Error(`Mach-O section ${sectionName} exceeds file size`);
          hash.update(buffer.subarray(fileOffset, fileOffset + sectionSize));
        }
        sectionCount += 1;
      }
    }
    commandOffset += commandSize;
  }
  if (sectionCount === 0) throw new Error('Mach-O binary contains no sections');
  return hash.digest('hex');
}

function verifySignedDarwinPayload({ runtime, arch, binaryPath, manifest }) {
  const sourceBinaryPath = runtime === 'codex'
    ? path.join(root, 'build', runtime, `darwin-${arch}`, 'bin', 'codex')
    : path.join(root, 'build', runtime, `darwin-${arch}`, 'cc-connect');
  if (!fs.existsSync(sourceBinaryPath)) {
    return [`signed Darwin verification requires source bundle ${sourceBinaryPath}`];
  }
  const sourceSha = sha256(sourceBinaryPath);
  if (sourceSha !== manifest.sha256) {
    return [`source bundle sha256 mismatch: manifest=${manifest.sha256}, source=${sourceSha}`];
  }
  try {
    const sourcePayloadSha = hashMachOSections(fs.readFileSync(sourceBinaryPath));
    const packagedPayloadSha = hashMachOSections(fs.readFileSync(binaryPath));
    if (sourcePayloadSha !== packagedPayloadSha) {
      return [`signed Mach-O section digest mismatch: source=${sourcePayloadSha}, packaged=${packagedPayloadSha}`];
    }
  } catch (error) {
    return [`signed Mach-O section verification failed: ${error.message}`];
  }
  try {
    childProcess.execFileSync('codesign', ['--verify', '--strict', binaryPath], { stdio: 'pipe' });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    return [`codesign verification failed: ${detail}`];
  }
  return [];
}

export function verifyPackagedRuntimeResources({ resources, platform, arch }) {
  const resourcesRoot = path.resolve(resources);
  const problems = [];
  for (const runtime of ['cc-connect', 'codex']) {
    const binaryName = platform === 'win32'
      ? `${runtime === 'cc-connect' ? 'cc-connect' : 'codex'}.exe`
      : runtime === 'cc-connect' ? 'cc-connect' : 'codex';
    const runtimeRoot = path.join(resourcesRoot, runtime);
    const binaryPath = runtime === 'codex'
      ? path.join(runtimeRoot, 'bin', binaryName)
      : path.join(runtimeRoot, binaryName);
    const manifestPath = path.join(runtimeRoot, 'manifest.json');
    if (!fs.existsSync(binaryPath)) {
      problems.push(`${runtime}: missing binary ${binaryPath}`);
      continue;
    }
    if (!fs.existsSync(manifestPath)) {
      problems.push(`${runtime}: missing manifest ${manifestPath}`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      problems.push(`${runtime}: invalid manifest JSON: ${error.message}`);
      continue;
    }
    const binaryBuffer = fs.readFileSync(binaryPath);
    const packagedSha = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
    const issues = validateRuntimeBundleManifest({
      name: runtime,
      version: pinnedVersion(runtime === 'cc-connect' ? 'cc-connect' : '@openai/codex'),
      nodePlatform: platform,
      nodeArch: arch,
      binaryName,
    }, manifest, packagedSha, fs.statSync(binaryPath).mode, binaryBuffer);
    const shaMismatchIndex = issues.findIndex(issue => issue.startsWith('sha256 mismatch:'));
    if (platform === 'darwin' && shaMismatchIndex >= 0) {
      const signedPayloadIssues = verifySignedDarwinPayload({ runtime, arch, binaryPath, manifest });
      if (signedPayloadIssues.length === 0) issues.splice(shaMismatchIndex, 1);
      else issues.push(...signedPayloadIssues);
    }
    for (const issue of issues) problems.push(`${runtime}: ${issue}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parsePackagedResourceArgs(process.argv.slice(2));
    const problems = verifyPackagedRuntimeResources(args);
    if (problems.length > 0) {
      console.error('Packaged runtime resource verification failed:');
      for (const problem of problems) console.error(`- ${problem}`);
      process.exit(1);
    }
    console.log(`Packaged runtime resources verified for ${args.platform}-${args.arch}: ${path.resolve(args.resources)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
