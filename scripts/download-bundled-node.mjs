#!/usr/bin/env zx

import 'zx/globals';
import { downloadBufferWithRetry } from './download-with-retry.mjs';

const ROOT_DIR = path.resolve(__dirname, '..');
// OpenClaw 2026.10.x requires Node >=24.16.0 (<25) or >=26.1.0; keep the Windows
// packaged runtime on the same Node 24.18 line as Electron 41.
const NODE_VERSION = '24.18.1';
// nodejs.org (Cloudflare) can drop GitHub-hosted runners mid-download, so the
// same archive is also fetched from a mirror. Both are checked against the
// SHA256 values published in nodejs.org's SHASUMS256.txt; update them with
// NODE_VERSION.
const BASE_URLS = [
  `https://nodejs.org/dist/v${NODE_VERSION}`,
  `https://cdn.npmmirror.com/binaries/node/v${NODE_VERSION}`,
];
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

const TARGETS = {
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
    sha256: 'ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765',
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
    sha256: 'ffbc7d3e1baf6804f7431ff94f19b9a885a650568c93ea4ccb1bb0038f6af825',
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64', 'win32-arm64'],
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_node_extract');
  const archivePath = path.join(ROOT_DIR, target.filename);
  const downloadUrls = BASE_URLS.map((baseUrl) => `${baseUrl}/${target.filename}`);

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  // Only remove the target binary, not the entire directory,
  // to avoid deleting uv.exe or other binaries placed by other download scripts.
  const outputNode = path.join(targetDir, 'node.exe');
  if (await fs.pathExists(outputNode)) {
    await fs.remove(outputNode);
  }
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrls[0]}`;
    const buffer = await downloadBufferWithRetry(downloadUrls, {
      label: target.filename,
      sha256: target.sha256,
    });
    await fs.writeFile(archivePath, buffer);

    echo`📂 Extracting...`;
    if (os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    } else {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, 'node.exe');
    if (await fs.pathExists(expectedNode)) {
      await fs.move(expectedNode, outputNode, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 node.exe not found in expected directory, searching...`);
      const files = await glob('**/node.exe', { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], outputNode, { overwrite: true });
      } else {
        throw new Error('Could not find node.exe in extracted files.');
      }
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all Windows targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  if (TARGETS[currentId]) {
    echo(chalk.cyan`💻 Detected Windows system: ${currentId}`);
    await setupTarget(currentId);
  } else {
    echo(chalk.cyan`🎯 Defaulting to Windows multi-arch Node.js download`);
    for (const id of PLATFORM_GROUPS.win) {
      await setupTarget(id);
    }
  }
}

echo(chalk.green`\n🎉 Done!`);
