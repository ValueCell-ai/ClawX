import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, chmodSync, renameSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// Configuration
const UV_VERSION = '0.10.0';
const BASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
const OUTPUT_BASE = join(ROOT_DIR, 'resources', 'bin');

// Mapping Node platforms/archs to uv release naming
const TARGETS = {
  'darwin-arm64': {
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    binName: 'uv',
    extractCmd: (src, dest) => spawnSync('tar', ['-xzf', src, '-C', dest])
  },
  'darwin-x64': {
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    binName: 'uv',
    extractCmd: (src, dest) => spawnSync('tar', ['-xzf', src, '-C', dest])
  },
  'win32-x64': {
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    binName: 'uv.exe',
    extractCmd: (src, dest) => {
      if (platform() === 'win32') {
        return spawnSync('powershell.exe', ['-Command', `Expand-Archive -Path "${src}" -DestinationPath "${dest}" -Force`]);
      } else {
        return spawnSync('unzip', ['-q', '-o', src, '-d', dest]);
      }
    }
  }
};

async function downloadFile(url, dest) {
  console.log(`⬇️ Downloading: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(dest, Buffer.from(arrayBuffer));
}

async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    console.warn(`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = join(OUTPUT_BASE, id);
  const tempDir = join(ROOT_DIR, 'temp_uv_extract');
  const archivePath = join(ROOT_DIR, target.filename);

  console.log(`
📦 Setting up uv for ${id}...`);

  // Cleanup & Prep
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true });
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  try {
    // Download
    await downloadFile(`${BASE_URL}/${target.filename}`, archivePath);

    // Extract
    console.log('📂 Extracting...');
    target.extractCmd(archivePath, tempDir);

    // Move binary to final location
    // uv archives usually contain a folder named after the target
    const folderName = target.filename.replace('.tar.gz', '').replace('.zip', '');
    const sourceBin = join(tempDir, folderName, target.binName);
    const destBin = join(targetDir, target.binName);

    if (existsSync(sourceBin)) {
      renameSync(sourceBin, destBin);
    } else {
      // Fallback: search for the binary if folder structure changed
      console.log('🔍 Binary not found in expected subfolder, searching...');
      const findResult = spawnSync(platform() === 'win32' ? 'where' : 'find', 
        platform() === 'win32' ? ['/R', tempDir, target.binName] : [tempDir, '-name', target.binName]);
      
      const foundPath = findResult.stdout.toString().trim().split('\n')[0];
      if (foundPath && existsSync(foundPath)) {
        renameSync(foundPath, destBin);
      } else {
        throw new Error(`Could not find ${target.binName} in extracted files.`);
      }
    }

    // Permission fix
    if (platform() !== 'win32') {
      chmodSync(destBin, 0o755);
    }

    console.log(`✅ Success: ${destBin}`);
  } finally {
    // Cleanup
    if (existsSync(archivePath)) rmSync(archivePath);
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const downloadAll = args.includes('--all');
  
  if (downloadAll) {
    console.log('🌐 Downloading uv binaries for ALL supported platforms...');
    for (const id of Object.keys(TARGETS)) {
      await setupTarget(id);
    }
  } else {
    const currentId = `${platform()}-${arch()}`;
    console.log(`💻 Detected system: ${currentId}`);
    
    if (TARGETS[currentId]) {
      await setupTarget(currentId);
    } else {
      console.error(`❌ Current system ${currentId} is not in the supported download list.`);
      console.log('Supported targets:', Object.keys(TARGETS).join(', '));
      process.exit(1);
    }
  }
  
  console.log('\n🎉 Done!');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
