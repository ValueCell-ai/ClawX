#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const UV_VERSION = '0.10.0';
const BASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

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
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
  }
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
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(archivePath, Buffer.from(buffer));

    // Extract
    echo`📂 Extracting...`;
    if (target.filename.endsWith('.zip')) {
      if (os.platform() === 'win32') {
        // Use .NET Framework for ZIP extraction (more reliable than Expand-Archive)
        const { execSync } = await import('child_process');
        const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
        execSync(`powershell.exe -NoProfile -Command "${psCommand}"`, { stdio: 'inherit' });
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
const args = process.argv.slice(3); // zx scripts/file.mjs --all -> argv is [node, zx, file, --all] ? or similar. 
// zx execution: process.argv is [node, script, users_args...]
// Let's use minimist which zx includes globally as `argv`
const downloadAll = argv.all;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading uv binaries for ALL supported platforms...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else {
  const currentId = `${os.platform()}-${os.arch()}`;
  echo(chalk.cyan`💻 Detected system: ${currentId}`);
  
  if (TARGETS[currentId]) {
    await setupTarget(currentId);
  } else {
    echo(chalk.red`❌ Current system ${currentId} is not in the supported download list.`);
    echo(`Supported targets: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

echo(chalk.green`\n🎉 Done!`);
