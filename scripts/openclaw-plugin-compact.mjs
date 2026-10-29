/**
 * Shrinks a bundled OpenClaw plugin mirror to as few files as possible.
 *
 * OpenClaw >=2026.10.5 copies and hashes every file of an external plugin
 * package (including its node_modules) into a source capture on each Gateway
 * start, at roughly 5 ms per file. A mirror with 2000+ dependency files costs
 * 10-15 s per plugin, so mirrors are compacted at build time:
 *   - bundle: re-bundle every own dist/ module with esbuild (code splitting
 *     keeps one instance per module and every entry at its original path) so
 *     only `keepPackages`, `rebundlePackages` (themselves bundled in place)
 *     and their remaining dependencies stay in node_modules;
 *   - prune: drop files a runtime never reads (sources, docs, typings, maps).
 * package.json dependencies are rewritten to the packages left on disk, since
 * the capture rejects plugins whose declared dependencies are missing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

/**
 * Compaction policy per mirror directory, shared by bundle-openclaw-plugins.mjs
 * (dev mirrors) and after-pack.cjs (packaged mirrors).
 * `keepPackages` stay as real packages: executables (wecom cli) or files
 * resolved next to the package at runtime. `rebundlePackages` stay installed
 * but are bundled in place (fs-safe loads its native addon by package name).
 */
export const PLUGIN_COMPACT_POLICIES = {
  dingtalk: { bundle: true },
  wecom: { bundle: true, keepPackages: ['@wecom/cli'] },
  // The Lark SDK only reads its own package.json for the User-Agent version
  // and falls back to "unknown" when the bundle moved it.
  'feishu-openclaw-plugin': {
    bundle: true,
    rebundlePackages: ['@openclaw/fs-safe'],
    modulePathReaders: ['@larksuiteoapi/node-sdk'],
  },
  // dist/index.cjs is already bundled; silk-wasm loads its .wasm from disk.
  qqbot: { bundle: false },
};

const JUNK_DIR_NAMES = new Set([
  'test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples',
  'benchmark', 'benchmarks', 'coverage', '.github',
]);
const JUNK_FILE_PATTERN = /(\.d\.[cm]?ts|\.d\.ts\.map|\.map|\.md|\.markdown)$/i;
const PLUGIN_ROOT_JUNK_DIRS = ['src', 'docs'];
const OWN_MODULE_PATTERN = /\.m?js$/;
const LICENSE_PATTERN = /^(licen[cs]e|copying|notice)(\..*)?$/i;
const ESBUILD_DYNAMIC_REQUIRE_MARKER = 'Dynamic require of "';
const REQUIRE_SHIM = 'import { createRequire as __clawxCreateRequire } from "node:module";\n'
  + 'const require = __clawxCreateRequire(import.meta.url);\n';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkFiles(dir, visit, skipDir = () => false) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDir(full, entry.name)) walkFiles(full, visit, skipDir);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

function countFiles(dir) {
  let count = 0;
  walkFiles(dir, () => { count += 1; });
  return count;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

/** Relative paths the package manifests point at; these are never pruned. */
export function collectReferencedPaths(pluginDir) {
  const refs = [];
  for (const name of ['package.json', 'openclaw.plugin.json']) {
    const file = path.join(pluginDir, name);
    if (!fs.existsSync(file)) continue;
    const manifest = readJson(file);
    collectStrings([manifest.main, manifest.module, manifest.exports, manifest.bin, manifest.openclaw], refs);
  }
  return new Set(
    refs
      .filter((ref) => ref.startsWith('./') || /^[\w.-]+\//.test(ref) || /\.[cm]?[jt]s$/.test(ref))
      .map((ref) => toPosix(path.normalize(ref)).replace(/^\.\//, '')),
  );
}

function isReferenced(rel, referenced) {
  const posix = toPosix(rel);
  for (const ref of referenced) {
    if (ref === posix || ref.startsWith(`${posix}/`)) return true;
  }
  return false;
}

function packageDir(nodeModules, name) {
  return path.join(nodeModules, ...name.split('/'));
}

function listInstalledPackages(nodeModules) {
  const names = [];
  if (!fs.existsSync(nodeModules)) return names;
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(nodeModules, entry))) names.push(`${entry}/${sub}`);
    } else {
      names.push(entry);
    }
  }
  return names;
}

/** `roots` plus every installed (optional) dependency they reach. */
export function resolvePackageClosure(nodeModules, roots) {
  const closure = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const manifestPath = path.join(packageDir(nodeModules, name), 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    closure.add(name);
    const manifest = readJson(manifestPath);
    queue.push(...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {}));
  }
  return closure;
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function pruneJunk(pluginDir, referenced) {
  for (const name of PLUGIN_ROOT_JUNK_DIRS) {
    if (!isReferenced(name, referenced)) fs.rmSync(path.join(pluginDir, name), { recursive: true, force: true });
  }
  const skillsDir = path.join(pluginDir, 'skills');
  const nodeModules = path.join(pluginDir, 'node_modules');
  walkFiles(
    pluginDir,
    (file) => {
      const rel = path.relative(pluginDir, file);
      if (JUNK_FILE_PATTERN.test(file) && !isReferenced(rel, referenced) && path.dirname(rel) !== '.') {
        fs.rmSync(file, { force: true });
      }
    },
    (dir, name) => {
      if (dir === skillsDir) return true;
      if (dir.startsWith(nodeModules) && JUNK_DIR_NAMES.has(name)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
      }
      return false;
    },
  );
}

/** Package an esbuild input belongs to, or null for a module of `rootDir` itself. */
function inputPackageOf(rootDir, input) {
  const absolute = path.resolve(rootDir, input);
  const own = toPosix(path.relative(rootDir, absolute));
  if (!own.startsWith('../') && !own.includes('node_modules/')) return null;
  const posix = toPosix(absolute);
  const index = posix.lastIndexOf('node_modules/');
  if (index < 0) return null;
  const parts = posix.slice(index + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function writeThirdPartyLicenses(pluginDir, nodeModules, packages) {
  const sections = [];
  for (const name of [...packages].sort()) {
    const dir = packageDir(nodeModules, name);
    let version = '';
    try {
      version = readJson(path.join(dir, 'package.json')).version ?? '';
    } catch {
      // A package without a readable manifest still gets its license listed.
    }
    const licenseFile = fs.existsSync(dir) ? fs.readdirSync(dir).find((file) => LICENSE_PATTERN.test(file)) : undefined;
    const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : '(no license file shipped)';
    sections.push(`${name}@${version}\n${'-'.repeat(60)}\n${text}`);
  }
  if (sections.length > 0) {
    fs.writeFileSync(path.join(pluginDir, 'THIRD_PARTY_LICENSES.txt'), `${sections.join('\n\n')}\n`);
  }
}

/** CommonJS module-path globals are undefined in the ESM bundle unless guarded or declared. */
function readsModulePath(source) {
  if (!fs.existsSync(source) || !/\.[cm]?js$/.test(source)) return false;
  const text = fs.readFileSync(source, 'utf8')
    .replace(/typeof\s+(__dirname|__filename)\s*!==?\s*["']undefined["']\s*\?\s*\1\b/g, '')
    .replace(/typeof\s+__(?:dirname|filename)\b/g, '');
  if (/(?:const|let|var)\s+__(?:dirname|filename)\b/.test(text)) return false;
  return /\b__(?:dirname|filename)\b/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''));
}

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !path.isAbsolute(specifier) && !/^[a-z][a-z0-9+.-]*:/i.test(specifier);
}

function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const MODULE_PATH_SHIM = [
  "import { fileURLToPath } from 'node:url';",
  "import { dirname } from 'node:path';",
  'export const __filename = fileURLToPath(import.meta.url);',
  'export const __dirname = dirname(__filename);',
  '',
].join('\n');

const MODULE_URL_PATTERN = /new URL\(\s*(["'])(\.{1,2}\/[^"'\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
/** Files a module locates relative to itself, e.g. workers and wasm next to it. */
function moduleUrlTargets(file, text) {
  return [...text.matchAll(MODULE_URL_PATTERN)].map((match) => path.resolve(path.dirname(file), match[2]));
}

/**
 * Bundles `entries` (absolute paths under `rootDir`) in place: every entry keeps
 * its path and shared code lands in `<rootDir>/dist/chunk-*.js`. Bare imports of
 * `external` packages stay imports; every other package is inlined.
 */
async function bundleModules({ rootDir, boundary, entries, external, esbuild, modulePathReaders }) {
  const label = path.basename(rootDir);
  if (readJson(path.join(rootDir, 'package.json')).type !== 'module') {
    throw new Error(`Cannot compact ${label}: chunks are ESM .js files, so the package needs "type": "module"`);
  }
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const unresolved = new Set();
  const keep = new Set(['openclaw', ...external]);
  const isInside = (file) => {
    const rel = path.relative(boundary, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const keepUnresolvedExternal = {
    name: 'clawx-keep-unresolved-external',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.clawxResolving || !isBareSpecifier(args.path) || builtins.has(args.path)) return undefined;
        if (keep.has(packageNameOf(args.path))) return { path: args.path, external: true };
        const result = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: { clawxResolving: true },
        });
        if (result.errors.length === 0 && isInside(result.path)) return result;
        // Optional dependencies the plugin never shipped (try/catch imports)
        // must keep failing at runtime instead of failing the build, and must
        // not be picked up from node_modules above the mirror.
        unresolved.add(args.path);
        return { path: args.path, external: true };
      });
    },
  };

  const outdir = path.join(rootDir, '.clawx-bundle-out');
  fs.rmSync(outdir, { recursive: true, force: true });
  const shimPath = path.join(rootDir, '.clawx-module-path-shim.mjs');
  if (modulePathReaders.size > 0) fs.writeFileSync(shimPath, MODULE_PATH_SHIM);
  const outputBase = (file) => toPosix(path.relative(rootDir, file)).replace(/\.m?js$/, '');
  const result = await esbuild.build({
    entryPoints: entries.map((file) => ({ in: file, out: outputBase(file) })),
    absWorkingDir: rootDir,
    outdir,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    chunkNames: 'dist/chunk-[hash]',
    external: [...keep].flatMap((name) => [name, `${name}/*`]),
    plugins: [keepUnresolvedExternal],
    inject: modulePathReaders.size > 0 ? [shimPath] : [],
    metafile: true,
    write: false,
    logLevel: 'warning',
  }).finally(() => fs.rmSync(shimPath, { force: true }));

  const finalPathOf = new Map();
  const entryByOutput = new Map();
  const explicitEntries = new Set(entries);
  for (const [outputRel, meta] of Object.entries(result.metafile.outputs)) {
    const outputAbs = path.resolve(rootDir, outputRel);
    const source = meta.entryPoint ? path.resolve(rootDir, meta.entryPoint) : null;
    if (source && explicitEntries.has(source)) {
      finalPathOf.set(outputAbs, source);
      entryByOutput.set(outputAbs, source);
    } else if (source) {
      // Dynamically imported ESM modules become implicit entries; they are
      // chunks too and must not be written back over their input.
      const id = createHash('sha256').update(toPosix(path.relative(rootDir, source))).digest('hex').slice(0, 8);
      finalPathOf.set(outputAbs, path.join(rootDir, 'dist', `chunk-lazy-${id}.js`));
    } else {
      finalPathOf.set(outputAbs, path.join(rootDir, path.relative(outdir, outputAbs)));
    }
  }

  const replaced = new Set(entries);
  for (const input of Object.keys(result.metafile.inputs)) {
    const absolute = path.resolve(rootDir, input);
    if (inputPackageOf(rootDir, input) === null && /\.[cm]?js$/.test(absolute)) replaced.add(absolute);
  }
  const written = new Set(finalPathOf.values());

  const problems = [];
  const writes = [];
  for (const file of result.outputFiles) {
    const meta = result.metafile.outputs[toPosix(path.relative(rootDir, file.path))];
    const target = finalPathOf.get(file.path);
    let text = file.text;
    const relinked = new Set();
    for (const imported of meta?.imports ?? []) {
      if (imported.external || relinked.has(imported.path)) continue;
      relinked.add(imported.path);
      const importedAbs = path.resolve(rootDir, imported.path);
      const importedFinal = finalPathOf.get(importedAbs);
      if (!importedFinal || importedFinal === path.join(rootDir, path.relative(outdir, importedAbs))) continue;
      const before = `./${toPosix(path.relative(path.dirname(file.path), importedAbs))}`.replace(/^\.\/\.\.\//, '../');
      const after = `./${toPosix(path.relative(path.dirname(target), importedFinal))}`.replace(/^\.\/\.\.\//, '../');
      if (before === after) continue;
      const quoted = new RegExp(`(["'])${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
      if (!quoted.test(text)) problems.push(`${path.relative(rootDir, target)}: cannot relink ${before}`);
      text = text.replace(quoted, `$1${after}$1`);
    }
    if (text.includes(ESBUILD_DYNAMIC_REQUIRE_MARKER) && !/^(?:const|let|var)\s+require\s*=/m.test(text)) {
      text = REQUIRE_SHIM + text;
    }
    const pathReaders = Object.keys(meta?.inputs ?? {}).filter((input) => !modulePathReaders.has(inputPackageOf(rootDir, input))
      && readsModulePath(path.resolve(rootDir, input)));
    if (pathReaders.length > 0) {
      problems.push(`${path.relative(rootDir, target)}: bundled code reads __dirname/__filename (${pathReaders.join(', ')})`);
    }
    for (const located of moduleUrlTargets(target, text)) {
      const survives = written.has(located) || (fs.existsSync(located) && !replaced.has(located));
      if (!survives) problems.push(`${path.relative(rootDir, target)}: locates missing ${path.relative(rootDir, located)}`);
    }
    // Output inside node_modules would be deleted with the package it landed in,
    // and a relative external import would point at a file nobody ships.
    const targetRel = toPosix(path.relative(rootDir, target));
    if (targetRel.startsWith('../') || targetRel.includes('node_modules/')) {
      problems.push(`${path.relative(rootDir, file.path)}: would be written outside the package to ${targetRel}`);
    }
    for (const imported of meta?.imports ?? []) {
      if (imported.external && !isBareSpecifier(imported.path) && !builtins.has(imported.path)) {
        problems.push(`${targetRel}: keeps a non-package import ${imported.path}`);
      }
    }
    writes.push({ target, text });
  }
  if (problems.length > 0) {
    throw new Error(`Cannot compact ${label}:\n  ${problems.join('\n  ')}`);
  }

  for (const file of replaced) fs.rmSync(file, { force: true });
  for (const { target, text } of writes) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  fs.rmSync(outdir, { recursive: true, force: true });
  removeEmptyDirs(path.join(rootDir, 'dist'));

  const bundledPackages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const name = inputPackageOf(rootDir, input);
    if (name && !keep.has(name)) bundledPackages.add(name);
  }
  return { entries: entries.length, chunks: writes.length - entryByOutput.size, bundledPackages, unresolved };
}

async function bundleOwnModules(pluginDir, keep, esbuild, modulePathReaders) {
  const entries = [];
  walkFiles(path.join(pluginDir, 'dist'), (file) => {
    if (OWN_MODULE_PATTERN.test(file)) entries.push(file);
  });
  if (entries.length === 0) throw new Error(`No dist/ modules to bundle in ${pluginDir}`);
  return bundleModules({ rootDir: pluginDir, boundary: pluginDir, entries, external: keep, esbuild, modulePathReaders });
}

/**
 * Entry modules of an installed package: its manifest targets plus every module
 * located through `new URL(..., import.meta.url)` (workers spawned by path).
 */
function packageEntries(pkgDir) {
  const entries = new Set();
  for (const ref of collectReferencedPaths(pkgDir)) {
    const file = path.join(pkgDir, ref);
    if (/\.[cm]?js$/.test(ref) && fs.existsSync(file) && fs.statSync(file).isFile()) entries.add(file);
  }
  walkFiles(pkgDir, (file) => {
    if (!/\.[cm]?js$/.test(file)) return;
    for (const located of moduleUrlTargets(file, fs.readFileSync(file, 'utf8'))) {
      if (/\.[cm]?js$/.test(located) && fs.existsSync(located)) entries.add(located);
    }
  }, (_dir, name) => name === 'node_modules');
  return [...entries];
}

/**
 * Re-bundles a package that must stay installed (it is imported by name or
 * ships native addons) so its internal modules collapse into a few chunks;
 * the dependencies it inlined are dropped from its manifest.
 */
async function rebundlePackage(pluginDir, name, external, esbuild) {
  const pkgDir = packageDir(path.join(pluginDir, 'node_modules'), name);
  const entries = packageEntries(pkgDir);
  if (entries.length === 0) throw new Error(`No entry modules to re-bundle in ${name}`);
  const summary = await bundleModules({
    rootDir: pkgDir, boundary: pluginDir, entries, external, esbuild, modulePathReaders: new Set(),
  });
  const manifestPath = path.join(pkgDir, 'package.json');
  const manifest = readJson(manifestPath);
  for (const field of ['dependencies', 'optionalDependencies']) {
    if (!manifest[field]) continue;
    const kept = Object.fromEntries(Object.entries(manifest[field]).filter(([dep]) => !summary.bundledPackages.has(dep)));
    if (Object.keys(kept).length > 0) manifest[field] = kept;
    else delete manifest[field];
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return summary;
}

function rewriteDependencies(pluginDir, onDisk) {
  const manifestPath = path.join(pluginDir, 'package.json');
  const manifest = readJson(manifestPath);
  for (const field of ['dependencies', 'optionalDependencies']) {
    if (!manifest[field]) continue;
    const kept = Object.fromEntries(Object.entries(manifest[field]).filter(([name]) => onDisk.has(name)));
    if (Object.keys(kept).length > 0) manifest[field] = kept;
    else delete manifest[field];
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * @param {string} pluginDir mirror directory with a flattened node_modules
 * `keepPackages` stay installed untouched (with their dependencies);
 * `rebundlePackages` stay installed but their modules and dependencies are
 * bundled in place, keeping manifest entries and files located via
 * `import.meta.url` at their paths.
 * `modulePathReaders` lists bundled packages allowed to read __dirname/__filename;
 * they see the directory of the chunk they land in.
 * @param {{ bundle?: boolean, keepPackages?: string[], rebundlePackages?: string[], modulePathReaders?: string[], esbuild?: typeof import('esbuild') }} options
 */
export async function compactPluginMirror(mirrorDir, options = {}) {
  // esbuild reports real paths; matching them needs a symlink-free root.
  const pluginDir = fs.realpathSync(mirrorDir);
  const before = countFiles(pluginDir);
  const referenced = collectReferencedPaths(pluginDir);
  const nodeModules = path.join(pluginDir, 'node_modules');
  let summary = {};

  if (options.bundle) {
    const esbuild = options.esbuild ?? await import('esbuild');
    const keepPackages = options.keepPackages ?? [];
    const rebundlePackages = options.rebundlePackages ?? [];
    const licensed = new Set();
    for (const name of rebundlePackages) {
      const external = new Set([...keepPackages, ...rebundlePackages.filter((other) => other !== name)]);
      const rebundled = await rebundlePackage(pluginDir, name, external, esbuild);
      rebundled.bundledPackages.forEach((dep) => licensed.add(dep));
    }
    const keep = resolvePackageClosure(nodeModules, [...keepPackages, ...rebundlePackages]);
    summary = await bundleOwnModules(pluginDir, keep, esbuild, new Set(options.modulePathReaders ?? []));
    summary.bundledPackages.forEach((dep) => licensed.add(dep));
    writeThirdPartyLicenses(pluginDir, nodeModules, licensed);
    summary.bundledPackages = licensed;
    for (const name of listInstalledPackages(nodeModules)) {
      if (!keep.has(name)) fs.rmSync(packageDir(nodeModules, name), { recursive: true, force: true });
    }
    if (fs.existsSync(nodeModules)) removeEmptyDirs(nodeModules);
  }

  pruneJunk(pluginDir, referenced);
  rewriteDependencies(pluginDir, new Set(listInstalledPackages(nodeModules)));
  return { ...summary, before, after: countFiles(pluginDir) };
}
