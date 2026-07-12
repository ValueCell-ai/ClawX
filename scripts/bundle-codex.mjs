#!/usr/bin/env zx
import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CODEX_VERSION_FALLBACK,
  buildCodexArchiveExtractionCommand,
  buildCodexVersionCommand,
  getCodexNativeTarballUrl,
  normalizeCodexTarget,
  parseCodexBundleArgs,
} from './codex-bundle-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'codex');
const execFileAsync = promisify(execFile);

function readCodexVersion() {
  const pkgPath = path.join(ROOT, 'node_modules', '.pnpm', '@openai+codex@0.137.0', 'node_modules', '@openai', 'codex', 'package.json');
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || CODEX_VERSION_FALLBACK;
  }
  const appPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return appPackage.devDependencies?.['@openai/codex']?.replace(/^[^\d]*/, '') || CODEX_VERSION_FALLBACK;
}

function outputDirFor(nodePlatform, nodeArch) {
  return path.join(OUTPUT_ROOT, `${nodePlatform}-${nodeArch}`);
}

function installedNativePackageRoot(version, packageSuffix) {
  const root = path.join(
    ROOT,
    'node_modules',
    '.pnpm',
    `@openai+codex@${version}-${packageSuffix}`,
    'node_modules',
    '@openai',
    'codex',
  );
  return fs.existsSync(root) ? root : null;
}

async function extractNativePackage(version, packageSuffix, tempDir) {
  const installed = installedNativePackageRoot(version, packageSuffix);
  if (installed) return installed;

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const url = getCodexNativeTarballUrl(version, packageSuffix);
  const archivePath = path.join(tempDir, `codex-${version}-${packageSuffix}.tgz`);
  echo`   Downloading ${url}`;
  const data = await fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  }).then((buffer) => Buffer.from(buffer));
  fs.writeFileSync(archivePath, data);
  const { command, args } = buildCodexArchiveExtractionCommand(archivePath, tempDir);
  await execFileAsync(command, args);
  return path.join(tempDir, 'package');
}

function canExecuteTargetOnHost(nodePlatform, nodeArch) {
  return nodePlatform === process.platform && nodeArch === process.arch;
}

async function bundleTarget(version, nodePlatform, nodeArch) {
  const target = normalizeCodexTarget(nodePlatform, nodeArch);
  const outputDir = outputDirFor(nodePlatform, nodeArch);
  const tempDir = path.join(ROOT, 'temp_codex_extract', `${nodePlatform}-${nodeArch}`);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDir, 'bin'), { recursive: true });

  const packageRoot = await extractNativePackage(version, target.packageSuffix, tempDir);
  const vendorRoot = path.join(packageRoot, 'vendor', target.targetTriple);
  const sourceBinary = path.join(vendorRoot, 'bin', target.binaryName);
  const sourcePathDir = path.join(vendorRoot, 'codex-path');
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`Codex native binary missing: ${sourceBinary}`);
  }
  fs.copyFileSync(sourceBinary, path.join(outputDir, 'bin', target.binaryName));
  if (fs.existsSync(sourcePathDir)) {
    fs.cpSync(sourcePathDir, path.join(outputDir, 'codex-path'), { recursive: true });
  }
  if (target.nodePlatform !== 'win32') {
    fs.chmodSync(path.join(outputDir, 'bin', target.binaryName), 0o755);
    const rgPath = path.join(outputDir, 'codex-path', 'rg');
    if (fs.existsSync(rgPath)) fs.chmodSync(rgPath, 0o755);
  }

  let verifiedWithVersionCommand = false;
  if (canExecuteTargetOnHost(nodePlatform, nodeArch)) {
    const binaryPath = path.join(outputDir, 'bin', target.binaryName);
    const { command, args } = buildCodexVersionCommand(binaryPath);
    const { stdout, stderr } = await execFileAsync(command, args);
    const versionOutput = `${stdout}${stderr}`;
    if (!versionOutput.includes(version)) {
      throw new Error(`Codex version mismatch: expected ${version}, got ${versionOutput.trim()}`);
    }
    verifiedWithVersionCommand = true;
  } else {
    echo`   Skipping --version for cross target ${nodePlatform}-${nodeArch}`;
  }

  const binaryPath = path.join(outputDir, 'bin', target.binaryName);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    name: 'codex',
    version,
    nodePlatform,
    nodeArch,
    packageSuffix: target.packageSuffix,
    targetTriple: target.targetTriple,
    binaryName: target.binaryName,
    sha256,
    verifiedWithVersionCommand,
  }, null, 2));
  fs.rmSync(tempDir, { recursive: true, force: true });
  echo`   OK Codex ${version} bundled for ${nodePlatform}-${nodeArch}`;
}

const version = readCodexVersion();
const { targets } = parseCodexBundleArgs();
echo`Bundling Codex v${version}...`;
for (const { nodePlatform, nodeArch } of targets) {
  await bundleTarget(version, nodePlatform, nodeArch);
}
