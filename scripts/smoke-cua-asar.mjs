#!/usr/bin/env node
// Import-only native regression: never construct a host or call permission APIs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const sourceResources = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'release/mac-arm64/ClawX.app/Contents/Resources');
const baseline = process.argv.includes('--baseline');
const artifact = process.argv.includes('--artifact');
assert(!(baseline && artifact), '--baseline and --artifact are separate checks');
assert(['darwin', 'win32'].includes(process.platform), 'Run on a supported desktop host');
const temp = mkdtempSync(join(tmpdir(), 'clawx-cua-asar-'));
try {
  const sourceAsar = join(sourceResources, 'app.asar');
  const input = join(temp, 'input');
  mkdirSync(input);
  // Use the actual packaged dependency bytes, not workspace node_modules mocks.
  for (const name of asar.listPackage(sourceAsar)) {
    const relative = name.replace(/^[/\\]/, '').replaceAll('\\', '/');
    if (!/^node_modules\/(?:@trycua|@ubjs)\//.test(relative)) continue;
    const info = asar.statFile(sourceAsar, relative);
    if (info.files) continue;
    assert(!info.link, `Unexpected packaged symlink: ${relative}`);
    const destination = join(input, relative);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, asar.extractFile(sourceAsar, relative));
  }
  const sdkPackage = JSON.parse(readFileSync(join(input, 'node_modules/@trycua/cua-driver/package.json'), 'utf8'));
  assert.equal(sdkPackage.version, '0.21.0');
  for (const entry of ['electron', 'embedded']) {
    assert.equal(sdkPackage.exports[`./${entry}`].import, `./dist/${entry}.js`);
  }
  if (!baseline) {
    await build({
      configFile: false,
      build: {
        outDir: input, emptyOutDir: false, minify: false,
        lib: { entry: resolve('electron/utils/cua-sdk.ts'), formats: ['cjs'], fileName: () => 'sdk.cjs' },
        rollupOptions: { external: ['electron', 'node:path', 'node:url'] },
      },
    });
  }
  writeFileSync(join(input, 'package.json'), JSON.stringify({ name: 'cua-import-smoke', main: 'main.cjs' }));
  writeFileSync(join(input, 'main.cjs'), `
    const { app } = require('electron');
    const assert = require('node:assert/strict');
    app.whenReady().then(async () => {
      try {
        assert.equal(process.type, 'browser');
        assert.equal(app.isPackaged, true);
        ${baseline ? '' : "require('./sdk.cjs');"}
        assert(!Object.keys(require.cache).some(p => p.endsWith('cua_driver_node_runtime.node')), 'Helper import loaded native code eagerly');
        const entry = process.env.CUA_SMOKE_ENTRY;
        const sdk = ${baseline ? "await import('@trycua/cua-driver/' + entry)" : "await require('./sdk.cjs').loadCuaSdk(entry)"};
        assert.equal(typeof sdk[entry === 'electron' ? 'requestMacOSPermissions' : 'EmbeddedCuaDriverHost'], 'function');
        // embedded.js defers dlopen. Initialize only generated ABI checks/callbacks,
        // not an EmbeddedCuaDriverHost (which could launch a daemon).
        if (entry === 'embedded') {
          const specifier = ${baseline ? "require('node:url').pathToFileURL(require('node:path').join(app.getAppPath(), 'node_modules/@trycua/cua-driver/dist/embedded.js')).href" : "require('./sdk.cjs').getCuaSdkSpecifier(entry)"};
          const generated = await import(new URL('./native/cua_driver_sdk.js', specifier).href);
          generated.default.initialize();
        }
        const libraries = process.report.getReport().sharedObjects.filter(p => /cua_driver_sdk\\.(dylib|dll)$/.test(p));
        assert(libraries.some(p => p.includes('app.asar.unpacked')), 'Native library was not loaded from a physical unpacked path: ' + libraries);
        console.log('CUA_SMOKE ' + JSON.stringify({ entry, electron: process.versions.electron, packaged: app.isPackaged, libraries }));
        app.exit(0);
      } catch (error) { console.error(String(error)); app.exit(1); }
    });
  `);
  const electron = require('electron');
  let executable;
  let resources;
  if (process.platform === 'darwin') {
    const appCopy = join(temp, 'CUA Smoke.app');
    cpSync(resolve(dirname(electron), '../..'), appCopy, { recursive: true });
    executable = join(appCopy, 'Contents/MacOS/CUASmoke');
    renameSync(join(appCopy, 'Contents/MacOS/Electron'), executable);
    resources = join(appCopy, 'Contents/Resources');
  } else {
    const appCopy = join(temp, 'electron');
    cpSync(dirname(electron), appCopy, { recursive: true });
    executable = join(appCopy, 'CUASmoke.exe');
    renameSync(join(appCopy, 'electron.exe'), executable);
    resources = join(appCopy, 'resources');
  }
  const config = parse(readFileSync('electron-builder.yml', 'utf8'));
  await asar.createPackageWithOptions(input, join(resources, 'app.asar'), {
    unpack: `{${config.asarUnpack.join(',')}}`,
  });
  if (artifact) {
    // Check the built artifact's actual unpacked layout instead of repairing it
    // by repacking with today's config. The source package remains read-only.
    const modules = join(resources, 'app.asar.unpacked/node_modules');
    rmSync(modules, { recursive: true, force: true });
    symlinkSync(join(sourceResources, 'app.asar.unpacked/node_modules'), modules, 'junction');
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let failed = false;
  for (const entry of ['electron', 'embedded']) {
    const result = spawnSync(executable, [], {
      env: { ...env, CUA_SMOKE_ENTRY: entry }, encoding: 'utf8', timeout: 30000,
    });
    console.log(`[${baseline ? 'baseline' : 'fixed'}:${entry}] exit=${result.status}`);
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error);
    failed ||= result.status !== 0 || !result.stdout.includes('CUA_SMOKE ');
  }
  assert(!failed, 'Packaged CUA native import failed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
