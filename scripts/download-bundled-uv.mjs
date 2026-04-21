#!/usr/bin/env zx

import 'zx/globals';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

const ROOT_DIR = path.resolve(__dirname, '..');
const UV_VERSION = '0.10.0';
const BASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

let networkConfigured = false;
let networkInfo = { proxy: undefined, caFile: undefined, rejectUnauthorized: true };
async function configureNetworkOnce() {
  if (networkConfigured) return;
  networkConfigured = true;

  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  const caFile =
    process.env.UV_DOWNLOAD_CA_FILE ??
    process.env.CLAWX_CA_FILE ??
    process.env.NODE_EXTRA_CA_CERTS;

  const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? false : true;
  networkInfo = { proxy, caFile, rejectUnauthorized };

  let ca;
  if (caFile) {
    try {
      ca = await fs.readFile(caFile);
    } catch {
      ca = undefined;
    }
  }

  if (!proxy && rejectUnauthorized && !ca) return;

  if (proxy) {
    setGlobalDispatcher(
      new ProxyAgent({
        uri: proxy,
        connect: { ca, rejectUnauthorized },
      }),
    );
    return;
  }

  setGlobalDispatcher(
    new Agent({
      connect: { ca, rejectUnauthorized },
    }),
  );
}

// Mapping Node platforms/archs to uv release naming
const TARGETS = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    binName: 'uv',
  },
  'win32-arm64': {
    filename: 'uv-aarch64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  },
  'linux-arm64': {
    filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  },
  'linux-x64': {
    filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    binName: 'uv',
  }
};

// Platform groups for building multi-arch packages
const PLATFORM_GROUPS = {
  'mac': ['darwin-x64', 'darwin-arm64'],
  'win': ['win32-x64', 'win32-arm64'],
  'linux': ['linux-x64', 'linux-arm64']
};

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, 'temp_uv_extract');
  const archivePath = path.join(ROOT_DIR, target.filename);
  const downloadUrl = `${BASE_URL}/${target.filename}`;

  echo(chalk.blue`\n📦 Setting up uv for ${id}...`);

  // Cleanup & Prep
  await fs.remove(targetDir);
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    // Download
    echo`⬇️ Downloading: ${downloadUrl}`;
    await configureNetworkOnce();
    let response;
    try {
      response = await fetch(downloadUrl);
    } catch (err) {
      const cause = err?.cause;
      const code = cause?.code ?? err?.code;
      if (code === 'ECONNREFUSED' && networkInfo.proxy) {
        throw new Error(
          `Proxy connection refused when downloading ${downloadUrl}.\n\n` +
            `Detected proxy: ${networkInfo.proxy}\n\n` +
            `Fix options:\n` +
            `- Start your proxy service, or\n` +
            `- Unset HTTPS_PROXY/HTTP_PROXY for this build environment.\n`,
        );
      }
      if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        throw new Error(
          `TLS certificate verification failed when downloading ${downloadUrl}.\n\n` +
            `Fix options:\n` +
            `- Preferred: export your corporate root CA to a PEM file and set NODE_EXTRA_CA_CERTS or UV_DOWNLOAD_CA_FILE to that file path.\n` +
            `- If you must use a proxy, set HTTPS_PROXY/HTTP_PROXY as well.\n` +
            `- Last resort (insecure): set NODE_TLS_REJECT_UNAUTHORIZED=0.\n`,
        );
      }
      throw err;
    }
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(archivePath, Buffer.from(buffer));

    // Extract
    echo`📂 Extracting...`;
    if (target.filename.endsWith('.zip')) {
      if (os.platform() === 'win32') {
        const { execFileSync } = await import('child_process');
        const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
      } else {
        await $`unzip -q -o ${archivePath} -d ${tempDir}`;
      }
    } else {
      await $`tar -xzf ${archivePath} -C ${tempDir}`;
    }

    // Move binary
    // uv archives usually contain a folder named after the target
    const folderName = target.filename.replace('.tar.gz', '').replace('.zip', '');
    const sourceBin = path.join(tempDir, folderName, target.binName);
    const destBin = path.join(targetDir, target.binName);

    if (await fs.pathExists(sourceBin)) {
      await fs.move(sourceBin, destBin, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 Binary not found in expected subfolder, searching...`);
      const files = await glob(`**/${target.binName}`, { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], destBin, { overwrite: true });
      } else {
        throw new Error(`Could not find ${target.binName} in extracted files.`);
      }
    }

    // Permission fix
    if (os.platform() !== 'win32') {
      await fs.chmod(destBin, 0o755);
    }

    echo(chalk.green`✅ Success: ${destBin}`);
  } finally {
    // Cleanup
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

// Main logic
const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  // Download for all platforms
  echo(chalk.cyan`🌐 Downloading uv binaries for ALL supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  // Download for a specific platform (e.g., --platform=mac)
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red`❌ Unknown platform: ${platform}`);
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }
  
  echo(chalk.cyan`🎯 Downloading uv binaries for platform: ${platform}`);
  echo(`   Architectures: ${targets.join(', ')}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  // Download for current system only (default for local dev)
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  
  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red`❌ Current system ${currentId} is not in the supported download list.`);
    echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
    echo(`\nTip: Use --platform=<platform> to download for a specific platform`);
    echo(`     Use --all to download for all platforms`);
    process.exit(1);
  }
}

echo(chalk.green`\n🎉 Done!`);
