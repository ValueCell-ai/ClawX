#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const AGENT_BROWSER_VERSION = 'v0.27.0';
const BASE_URL = `https://github.com/vercel-labs/agent-browser/releases/download/${AGENT_BROWSER_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

// Mapping Node platforms/archs to agent-browser release asset naming.
// Assets are bare binaries (no archive). win32-arm64 has no native asset, so
// it reuses the win32-x64 binary (runs via Windows-on-ARM x64 emulation).
const TARGETS = {
  'darwin-arm64': {
    asset: 'agent-browser-darwin-arm64',
    binName: 'agent-browser',
  },
  'darwin-x64': {
    asset: 'agent-browser-darwin-x64',
    binName: 'agent-browser',
  },
  'win32-x64': {
    asset: 'agent-browser-win32-x64.exe',
    binName: 'agent-browser.exe',
  },
  'win32-arm64': {
    asset: 'agent-browser-win32-x64.exe',
    binName: 'agent-browser.exe',
  },
  'linux-arm64': {
    asset: 'agent-browser-linux-arm64',
    binName: 'agent-browser',
  },
  'linux-x64': {
    asset: 'agent-browser-linux-x64',
    binName: 'agent-browser',
  },
};

// Platform groups for building multi-arch packages
const PLATFORM_GROUPS = {
  mac: ['darwin-x64', 'darwin-arm64'],
  win: ['win32-x64', 'win32-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
};

// Collected per-target results so we can print an install summary at the end,
// which is the part that should clearly show up in CI / pipeline logs.
const installed = [];

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} bytes)`;
}

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow(`⚠️ Target ${id} is not supported by this script.`));
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const destBin = path.join(targetDir, target.binName);
  const downloadUrl = `${BASE_URL}/${target.asset}`;
  const reusesX64 = id === 'win32-arm64';

  echo(chalk.blue(`\n📦 [agent-browser ${AGENT_BROWSER_VERSION}] Installing for ${id}...`));
  echo(`   asset:  ${target.asset}${reusesX64 ? ' (no native arm64 asset; reusing win32-x64)' : ''}`);
  echo(`   dest:   ${destBin}`);

  // Only remove our own binary, not the entire directory, to avoid deleting
  // uv / node binaries placed by other download scripts.
  if (await fs.pathExists(destBin)) {
    await fs.remove(destBin);
  }
  await fs.ensureDir(targetDir);

  // Download (bare binary — no extraction needed)
  const startedAt = Date.now();
  echo(`   ⬇️  Downloading: ${downloadUrl}`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${target.asset}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await fs.writeFile(destBin, Buffer.from(buffer));

  // Permission fix
  if (os.platform() !== 'win32') {
    await fs.chmod(destBin, 0o755);
  }

  const { size } = await fs.stat(destBin);
  const elapsedMs = Date.now() - startedAt;
  echo(chalk.green(`   ✅ Installed ${id}: ${formatBytes(size)} in ${(elapsedMs / 1000).toFixed(1)}s`));

  installed.push({ id, asset: target.asset, dest: destBin, size });
}

function printSummary() {
  echo(chalk.cyan(`\n──────── agent-browser install summary ────────`));
  echo(chalk.cyan(`version: ${AGENT_BROWSER_VERSION}`));
  if (installed.length === 0) {
    echo(chalk.yellow(`no binaries were installed.`));
  } else {
    for (const item of installed) {
      echo(`  • ${item.id.padEnd(13)} ${formatBytes(item.size).padEnd(28)} ${item.dest}`);
    }
    echo(chalk.cyan(`total: ${installed.length} binary(ies) installed.`));
  }
  echo(chalk.cyan(`───────────────────────────────────────────────`));
}

// Main logic
const downloadAll = argv.all;
const platform = argv.platform;

echo(chalk.cyan(`🔧 agent-browser bundler — version ${AGENT_BROWSER_VERSION}`));
echo(chalk.cyan(`   source: ${BASE_URL}`));
echo(chalk.cyan(`   output: ${OUTPUT_BASE}/<platform-arch>/`));

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading agent-browser binaries for ALL supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
  const targets = PLATFORM_GROUPS[platform];
  if (!targets) {
    echo(chalk.red(`❌ Unknown platform: ${platform}`));
    echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
    process.exit(1);
  }

  echo(chalk.cyan(`🎯 Downloading agent-browser binaries for platform: ${platform}`));
  echo(`   Architectures: ${targets.join(', ')}`);
  for (const id of targets) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan(`💻 Detected system: ${currentId}`));

  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red(`❌ Current system ${currentId} is not in the supported download list.`));
    echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
    echo(`\nTip: Use --platform=<platform> to download for a specific platform`);
    echo(`     Use --all to download for all platforms`);
    process.exit(1);
  }
}

printSummary();

echo(chalk.green`\n🎉 Done!`);
