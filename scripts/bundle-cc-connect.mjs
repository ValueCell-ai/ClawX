#!/usr/bin/env zx
import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CC_CONNECT_VERSION_FALLBACK,
  buildCcConnectAssetName,
  getCcConnectDownloadUrls,
  normalizeCcConnectTarget,
  parseCcConnectBundleArgs,
} from './cc-connect-bundle-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'cc-connect');

function readCcConnectVersion() {
  const pkgPath = path.join(ROOT, 'node_modules', 'cc-connect', 'package.json');
  if (!fs.existsSync(pkgPath)) return CC_CONNECT_VERSION_FALLBACK;
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || CC_CONNECT_VERSION_FALLBACK;
}

function nodeTargetDir(nodePlatform, nodeArch) {
  return path.join(OUTPUT_ROOT, `${nodePlatform}-${nodeArch}`);
}

async function download(urls) {
  for (const url of urls) {
    try {
      echo`   Downloading ${url}`;
      return { url, data: await fetch(url).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      }).then((buffer) => Buffer.from(buffer)) };
    } catch (error) {
      echo`   WARN ${url} failed: ${error.message}`;
    }
  }
  throw new Error(`Could not download cc-connect from ${urls.join(', ')}`);
}

async function extractArchive(archivePath, outputDir, isWindows) {
  if (isWindows) {
    try {
      await $`unzip -o ${archivePath} -d ${outputDir}`;
    } catch {
      await $`powershell -NoProfile -Command Expand-Archive -Force ${archivePath} ${outputDir}`;
    }
    return;
  }
  await $`tar xzf ${archivePath} -C ${outputDir}`;
}

function canExecuteTargetOnHost(nodePlatform, nodeArch) {
  return nodePlatform === process.platform && nodeArch === process.arch;
}

async function bundleTarget(version, nodePlatform, nodeArch) {
  const target = normalizeCcConnectTarget(nodePlatform, nodeArch);
  const assetName = buildCcConnectAssetName(version, target);
  const urls = getCcConnectDownloadUrls(version, assetName);
  const outputDir = nodeTargetDir(nodePlatform, nodeArch);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const { url, data } = await download(urls);
  const archivePath = path.join(outputDir, assetName);
  fs.writeFileSync(archivePath, data);
  await extractArchive(archivePath, outputDir, target.platform === 'windows');
  fs.rmSync(archivePath, { force: true });

  const binaryName = target.platform === 'windows' ? 'cc-connect.exe' : 'cc-connect';
  const extracted = fs.readdirSync(outputDir).find((name) => name.startsWith('cc-connect') && name !== binaryName);
  if (extracted) {
    fs.renameSync(path.join(outputDir, extracted), path.join(outputDir, binaryName));
  }
  const binaryPath = path.join(outputDir, binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`cc-connect binary missing after extraction: ${binaryPath}`);
  }
  if (target.platform !== 'windows') {
    fs.chmodSync(binaryPath, 0o755);
  }

  let verifiedWithVersionCommand = false;
  if (canExecuteTargetOnHost(nodePlatform, nodeArch)) {
    const versionOutput = await $`${binaryPath} --version`.text();
    if (!versionOutput.includes(version)) {
      throw new Error(`cc-connect version mismatch: expected ${version}, got ${versionOutput.trim()}`);
    }
    verifiedWithVersionCommand = true;
  } else {
    echo`   Skipping --version for cross target ${nodePlatform}-${nodeArch}`;
  }

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(binaryPath)).digest('hex');
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    name: 'cc-connect',
    version,
    nodePlatform,
    nodeArch,
    platform: target.platform,
    arch: target.arch,
    sourceUrl: url,
    assetName,
    binaryName,
    sha256,
    verifiedWithVersionCommand,
  }, null, 2));
  echo`   OK cc-connect ${version} bundled for ${nodePlatform}-${nodeArch}`;
}

const version = readCcConnectVersion();
const { targets } = parseCcConnectBundleArgs();
echo`Bundling cc-connect v${version}...`;
for (const { nodePlatform, nodeArch } of targets) {
  await bundleTarget(version, nodePlatform, nodeArch);
}
