#!/usr/bin/env zx

/**
 * bundle-openclaw.mjs
 *
 * Bundles the openclaw npm package with ALL its dependencies (including
 * transitive ones) into a self-contained directory (build/openclaw/) for
 * electron-builder to pick up.
 *
 * pnpm uses a content-addressable virtual store with symlinks. A naive copy
 * of node_modules/openclaw/ will miss runtime dependencies entirely. Even
 * copying only direct siblings misses transitive deps (e.g. @clack/prompts
 * depends on @clack/core which lives in a separate virtual store entry).
 *
 * This script performs a recursive BFS through pnpm's virtual store to
 * collect every transitive dependency into a flat node_modules structure.
 */

import 'zx/globals';

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'openclaw');
const NODE_MODULES = path.join(ROOT, 'node_modules');

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

echo`📦 Bundling openclaw for electron-builder...`;

// 1. Resolve the real path of node_modules/openclaw (follows pnpm symlink)
const openclawLink = path.join(NODE_MODULES, 'openclaw');
if (!fs.existsSync(openclawLink)) {
  echo`❌ node_modules/openclaw not found. Run pnpm install first.`;
  process.exit(1);
}

const openclawReal = fs.realpathSync(openclawLink);
echo`   openclaw resolved: ${openclawReal}`;

// 2. Clean and create output directory
if (fs.existsSync(OUTPUT)) {
  fs.rmSync(OUTPUT, { recursive: true });
}
fs.mkdirSync(OUTPUT, { recursive: true });

// 3. Copy openclaw package itself to OUTPUT root
echo`   Copying openclaw package...`;
fs.cpSync(openclawReal, OUTPUT, { recursive: true, dereference: true });

// 4. Recursively collect ALL transitive dependencies via pnpm virtual store BFS
//
// pnpm structure example:
//   .pnpm/openclaw@ver/node_modules/
//     openclaw/          <- real files
//     chalk/             <- symlink -> .pnpm/chalk@ver/node_modules/chalk
//     @clack/prompts/    <- symlink -> .pnpm/@clack+prompts@ver/node_modules/@clack/prompts
//
//   .pnpm/@clack+prompts@ver/node_modules/
//     @clack/prompts/    <- real files
//     @clack/core/       <- symlink (transitive dep, NOT in openclaw's siblings!)
//
// We BFS from openclaw's virtual store node_modules, following each symlink
// to discover the target's own virtual store node_modules and its deps.

const collected = new Map(); // realPath -> packageName (for deduplication)
const queue = []; // BFS queue of virtual-store node_modules dirs to visit

/**
 * Given a real path of a package, find the containing virtual-store node_modules.
 * e.g. .pnpm/chalk@5.4.1/node_modules/chalk -> .pnpm/chalk@5.4.1/node_modules
 * e.g. .pnpm/@clack+core@0.4.1/node_modules/@clack/core -> .pnpm/@clack+core@0.4.1/node_modules
 */
function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * List all package entries in a virtual-store node_modules directory.
 * Handles both regular packages (chalk) and scoped packages (@clack/prompts).
 * Returns array of { name, fullPath }.
 */
function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) path so callers can call
    // getVirtualStoreNodeModules() on fullPath correctly.
    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      try {
        const scopeEntries = fs.readdirSync(normWin(entryPath));
        for (const sub of scopeEntries) {
          result.push({
            name: `${entry}/${sub}`,
            fullPath: path.join(entryPath, sub),
          });
        }
      } catch {
        // Not a directory, skip
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

// Start BFS from openclaw's virtual store node_modules
const openclawVirtualNM = getVirtualStoreNodeModules(openclawReal);
if (!openclawVirtualNM) {
  echo`❌ Could not determine pnpm virtual store for openclaw`;
  process.exit(1);
}

echo`   Virtual store root: ${openclawVirtualNM}`;
queue.push({ nodeModulesDir: openclawVirtualNM, skipPkg: 'openclaw' });

const SKIP_PACKAGES = new Set([
  'typescript',
  '@playwright/test',
  // @discordjs/opus is a native .node addon compiled for the system Node.js
  // ABI. The Gateway runs inside Electron's utilityProcess which has a
  // different ABI, so the binary fails with "Cannot find native binding".
  // The package is optional — openclaw gracefully degrades when absent
  // (only Discord voice features are affected; text chat works fine).
  '@discordjs/opus',
]);
const SKIP_SCOPES = ['@cloudflare/', '@types/'];
let skippedDevCount = 0;

while (queue.length > 0) {
  const { nodeModulesDir, skipPkg } = queue.shift();
  const packages = listPackages(nodeModulesDir);

  for (const { name, fullPath } of packages) {
    // Skip the package that owns this virtual store entry (it's the package itself, not a dep)
    if (name === skipPkg) continue;

    if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) {
      skippedDevCount++;
      continue;
    }

    let realPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      continue; // broken symlink, skip
    }

    if (collected.has(realPath)) continue; // already visited
    collected.set(realPath, name);

    // Find this package's own virtual store node_modules to discover ITS deps
    const depVirtualNM = getVirtualStoreNodeModules(realPath);
    if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
      // Determine the package's "self name" in its own virtual store
      // For scoped: @clack/core -> skip "@clack/core" when scanning
      queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
    }
  }
}

echo`   Found ${collected.size} total packages (direct + transitive)`;
echo`   Skipped ${skippedDevCount} dev-only package references`;

// 4b. Collect extra packages required by ClawX's Electron main process that are
//     NOT deps of openclaw.  These are resolved from openclaw's context at runtime
//     (via createRequire from the openclaw directory) so they must live in the
//     bundled openclaw/node_modules/.
//
//     For each package we resolve it from the workspace's own node_modules,
//     then BFS its transitive deps exactly like we did for openclaw above.
const EXTRA_BUNDLED_PACKAGES = [
  '@whiskeysockets/baileys',   // WhatsApp channel (was a dep of old clawdbot, not openclaw)
];

let extraCount = 0;
for (const pkgName of EXTRA_BUNDLED_PACKAGES) {
  const pkgLink = path.join(NODE_MODULES, ...pkgName.split('/'));
  if (!fs.existsSync(pkgLink)) {
    echo`   ⚠️  Extra package ${pkgName} not found in workspace node_modules, skipping.`;
    continue;
  }

  let pkgReal;
  try { pkgReal = fs.realpathSync(pkgLink); } catch { continue; }

  if (!collected.has(pkgReal)) {
    collected.set(pkgReal, pkgName);
    extraCount++;

    // BFS this package's own transitive deps
    const depVirtualNM = getVirtualStoreNodeModules(pkgReal);
    if (depVirtualNM) {
      const extraQueue = [{ nodeModulesDir: depVirtualNM, skipPkg: pkgName }];
      while (extraQueue.length > 0) {
        const { nodeModulesDir, skipPkg } = extraQueue.shift();
        const packages = listPackages(nodeModulesDir);
        for (const { name, fullPath } of packages) {
          if (name === skipPkg) continue;
          if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
          let realPath;
          try { realPath = fs.realpathSync(fullPath); } catch { continue; }
          if (collected.has(realPath)) continue;
          collected.set(realPath, name);
          extraCount++;
          const innerVirtualNM = getVirtualStoreNodeModules(realPath);
          if (innerVirtualNM && innerVirtualNM !== nodeModulesDir) {
            extraQueue.push({ nodeModulesDir: innerVirtualNM, skipPkg: name });
          }
        }
      }
    }
  }
}

if (extraCount > 0) {
  echo`   Added ${extraCount} extra packages (+ transitive deps) for Electron main process`;
}

// 5. Copy all collected packages into OUTPUT/node_modules/ (flat structure)
//
// IMPORTANT: BFS guarantees direct deps are encountered before transitive deps.
// When the same package name appears at different versions (e.g. chalk@5 from
// openclaw directly, chalk@4 from a transitive dep), we keep the FIRST one
// (direct dep version) and skip later duplicates. This prevents version
// conflicts like CJS chalk@4 overwriting ESM chalk@5.
const outputNodeModules = path.join(OUTPUT, 'node_modules');
fs.mkdirSync(outputNodeModules, { recursive: true });

const copiedNames = new Set(); // Track package names already copied
let copiedCount = 0;
let skippedDupes = 0;

for (const [realPath, pkgName] of collected) {
  if (copiedNames.has(pkgName)) {
    skippedDupes++;
    continue; // Keep the first version (closer to openclaw in dep tree)
  }
  copiedNames.add(pkgName);

  const dest = path.join(outputNodeModules, pkgName);

  try {
    fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
    fs.cpSync(normWin(realPath), normWin(dest), { recursive: true, dereference: true });
    copiedCount++;
  } catch (err) {
    echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
  }
}

// 5b. Merge built-in extension node_modules into top-level node_modules
//
// OpenClaw 3.31+ ships built-in extensions (telegram, discord, etc.) under
// dist/extensions/<ext>/node_modules/.  The Rollup bundler creates shared
// chunks at dist/ root (e.g. sticker-cache-*.js) that eagerly import
// extension-specific packages like "grammy".  Node.js resolves bare
// specifiers from the importing file's directory upward:
//   dist/ → openclaw/ → openclaw/node_modules/
// It does NOT search dist/extensions/telegram/node_modules/.
//
// Fix: copy extension deps into the top-level node_modules/ so they are
// resolvable from shared chunks.  Skip-if-exists preserves version priority
// (openclaw's own deps take precedence over extension deps).
const extensionsDir = path.join(OUTPUT, 'dist', 'extensions');
let mergedExtCount = 0;
if (fs.existsSync(extensionsDir)) {
  for (const extEntry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extEntry.isDirectory()) continue;
    const extNM = path.join(extensionsDir, extEntry.name, 'node_modules');
    if (!fs.existsSync(extNM)) continue;

    for (const pkgEntry of fs.readdirSync(extNM, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory() || pkgEntry.name === '.bin') continue;
      const srcPkg = path.join(extNM, pkgEntry.name);

      if (pkgEntry.name.startsWith('@')) {
        // Scoped package — iterate sub-entries
        let scopeEntries;
        try { scopeEntries = fs.readdirSync(srcPkg, { withFileTypes: true }); } catch { continue; }
        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;
          const scopedName = `${pkgEntry.name}/${scopeEntry.name}`;
          if (copiedNames.has(scopedName)) continue;
          const srcScoped = path.join(srcPkg, scopeEntry.name);
          const destScoped = path.join(outputNodeModules, pkgEntry.name, scopeEntry.name);
          try {
            fs.mkdirSync(normWin(path.dirname(destScoped)), { recursive: true });
            fs.cpSync(normWin(srcScoped), normWin(destScoped), { recursive: true, dereference: true });
            copiedNames.add(scopedName);
            mergedExtCount++;
          } catch { /* skip on copy error */ }
        }
      } else {
        if (copiedNames.has(pkgEntry.name)) continue;
        const destPkg = path.join(outputNodeModules, pkgEntry.name);
        try {
          fs.cpSync(normWin(srcPkg), normWin(destPkg), { recursive: true, dereference: true });
          copiedNames.add(pkgEntry.name);
          mergedExtCount++;
        } catch { /* skip on copy error */ }
      }
    }
  }
}

if (mergedExtCount > 0) {
  echo`   Merged ${mergedExtCount} extension packages into top-level node_modules`;
}

// 6. Clean up the bundle to reduce package size
//
// This removes platform-agnostic waste: dev artifacts, docs, source maps,
// type definitions, test directories, and known large unused subdirectories.
// Platform-specific cleanup (e.g. koffi binaries) is handled in after-pack.cjs
// which has access to the target platform/arch context.

function getDirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += getDirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* ignore */ }
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function rmSafe(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    return true;
  } catch { return false; }
}

function cleanupBundle(outputDir) {
  let removedCount = 0;
  const nm = path.join(outputDir, 'node_modules');
  const ext = path.join(outputDir, 'extensions');

  // --- openclaw root junk ---
  for (const name of ['CHANGELOG.md', 'README.md']) {
    if (rmSafe(path.join(outputDir, name))) removedCount++;
  }

  // docs/ is kept — contains prompt templates and other runtime-used prompts

  // --- extensions: clean junk from source, aggressively clean nested node_modules ---
  // Extension source (.ts files) are runtime entry points — must be preserved.
  // Only nested node_modules/ inside extensions get the aggressive cleanup.
  if (fs.existsSync(ext)) {
    const JUNK_EXTS = new Set(['.prose', '.ignored_openclaw', '.keep']);
    const NM_REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const NM_REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
    const NM_REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    // .md files inside skills/ directories are runtime content (SKILL.md,
    // block-types.md, etc.) and must NOT be removed.
    const JUNK_MD_NAMES = new Set([
      'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    ]);

    function walkExt(dir, insideNodeModules, insideSkills) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (insideNodeModules && NM_REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkExt(
              full,
              insideNodeModules || entry.name === 'node_modules',
              insideSkills || entry.name === 'skills',
            );
          }
        } else if (entry.isFile()) {
          if (insideNodeModules) {
            const name = entry.name;
            if (NM_REMOVE_FILE_NAMES.has(name) || NM_REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
              if (rmSafe(full)) removedCount++;
            }
          } else {
            // Inside skills/ directories, .md files are skill content — keep them.
            // Outside skills/, remove known junk .md files only.
            const isMd = entry.name.endsWith('.md');
            const isJunkMd = isMd && JUNK_MD_NAMES.has(entry.name);
            const isJunkExt = JUNK_EXTS.has(path.extname(entry.name));
            if (isJunkExt || (isMd && !insideSkills && isJunkMd)) {
              if (rmSafe(full)) removedCount++;
            }
          }
        }
      }
    }
    walkExt(ext, false, false);
  }

  // --- node_modules: remove unnecessary file types and directories ---
  if (fs.existsSync(nm)) {
    const REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
    const REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    function walkClean(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkClean(full);
          }
        } else if (entry.isFile()) {
          const name = entry.name;
          if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
            if (rmSafe(full)) removedCount++;
          }
        }
      }
    }
    walkClean(nm);
  }

  // --- known large unused subdirectories ---
  const LARGE_REMOVALS = [
    'node_modules/pdfjs-dist/legacy',
    'node_modules/pdfjs-dist/types',
    'node_modules/node-llama-cpp/llama',
    'node_modules/koffi/src',
    'node_modules/koffi/vendor',
    'node_modules/koffi/doc',
    'extensions/feishu', // Removed in favor of official @larksuite/openclaw-lark plugin
  ];
  for (const rel of LARGE_REMOVALS) {
    if (rmSafe(path.join(outputDir, rel))) removedCount++;
  }

  return removedCount;
}

echo``;
echo`🧹 Cleaning up bundle (removing dev artifacts, docs, source maps, type defs)...`;
const sizeBefore = getDirSize(OUTPUT);
const cleanedCount = cleanupBundle(OUTPUT);
const sizeAfter = getDirSize(OUTPUT);
echo`   Removed ${cleanedCount} files/directories`;
echo`   Size: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)} (saved ${formatSize(sizeBefore - sizeAfter)})`;

// 7. Patch known broken packages
//
// Some packages in the ecosystem have transpiled CJS output that sets
// `module.exports = exports.default` without ever assigning `exports.default`,
// resulting in `module.exports = undefined`.  This causes a TypeError in
// Node.js 22+ ESM interop when the translators try to call hasOwnProperty on
// the undefined exports object.
//
// We also patch Windows child_process spawn sites in the bundled agent runtime
// so shell/tool execution does not flash a console window for each tool call.
// We patch these files in-place after the copy so the bundle is safe to run.
function patchBrokenModules(nodeModulesDir) {
  const rewritePatches = {
    // node-domexception@1.0.0: transpiled index.js leaves module.exports = undefined.
    // Node.js 18+ ships DOMException as a built-in global, so a simple shim works.
    'node-domexception/index.js': [
      `'use strict';`,
      `// Shim: the original transpiled file sets module.exports = exports.default`,
      `// (which is undefined), causing TypeError in Node.js 22+ ESM interop.`,
      `// Node.js 18+ has DOMException as a built-in global.`,
      `const dom = globalThis.DOMException ||`,
      `  class DOMException extends Error {`,
      `    constructor(msg, name) { super(msg); this.name = name || 'Error'; }`,
      `  };`,
      `module.exports = dom;`,
      `module.exports.DOMException = dom;`,
      `module.exports.default = dom;`,
    ].join('\n'),
  };
  const replacePatches = [
    // Note: @mariozechner/pi-coding-agent is no longer a dep of openclaw 3.31.
  ];

  let count = 0;
  for (const [rel, content] of Object.entries(rewritePatches)) {
    const target = path.join(nodeModulesDir, rel);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, content + '\n', 'utf8');
      count++;
    }
  }
  for (const { rel, search, replace } of replacePatches) {
    const target = path.join(nodeModulesDir, rel);
    if (!fs.existsSync(target)) continue;

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(search)) {
      echo`   ⚠️  Skipped patch for ${rel}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(search, replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }
  // lru-cache CJS/ESM interop fix (recursive):
  // Multiple versions of lru-cache may exist in the output tree — not just
  // at node_modules/lru-cache/ but also nested inside other packages.
  // Older CJS versions (v5, v6) export the class via `module.exports = LRUCache`
  // without a named `LRUCache` property, so `import { LRUCache } from 'lru-cache'`
  // fails in Node.js 22+ ESM interop (used by Electron 40+).
  // We recursively scan the entire output for ALL lru-cache installations and
  // patch each CJS entry to ensure `exports.LRUCache` always exists.
  function patchAllLruCacheInstances(rootDir) {
    let lruCount = 0;
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(normWin(dir), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          // pnpm layout may contain symlink/junction directories on Windows.
          try { isDirectory = fs.statSync(normWin(fullPath)).isDirectory(); } catch { isDirectory = false; }
        }
        if (!isDirectory) continue;
        if (entry.name === 'lru-cache') {
          const pkgPath = path.join(fullPath, 'package.json');
          if (!fs.existsSync(normWin(pkgPath))) { stack.push(fullPath); continue; }
          try {
            const pkg = JSON.parse(fs.readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type === 'module') continue; // ESM version — already has named exports
            const mainFile = pkg.main || 'index.js';
            const entryFile = path.join(fullPath, mainFile);
            if (!fs.existsSync(normWin(entryFile))) continue;
            const original = fs.readFileSync(normWin(entryFile), 'utf8');
            if (!original.includes('exports.LRUCache')) {
              const patched = [
                original,
                '',
                '// ClawX patch: add LRUCache named export for Node.js 22+ ESM interop',
                'if (typeof module.exports === "function" && !module.exports.LRUCache) {',
                '  module.exports.LRUCache = module.exports;',
                '}',
                '',
              ].join('\n');
              fs.writeFileSync(normWin(entryFile), patched, 'utf8');
              lruCount++;
              echo`   🩹 Patched lru-cache CJS (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
            }

            // lru-cache v7 ESM entry exports default only; add named export.
            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = path.join(fullPath, moduleFile);
              if (fs.existsSync(normWin(esmEntry))) {
                const esmOriginal = fs.readFileSync(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache') &&
                  !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  fs.writeFileSync(normWin(esmEntry), esmPatched, 'utf8');
                  lruCount++;
                  echo`   🩹 Patched lru-cache ESM (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
                }
              }
            }
          } catch (err) {
            echo`   ⚠️  Failed to patch lru-cache at ${fullPath}: ${err.message}`;
          }
        } else {
          stack.push(fullPath);
        }
      }
    }
    return lruCount;
  }
  const lruPatched = patchAllLruCacheInstances(nodeModulesDir);
  count += lruPatched;

  if (count > 0) {
    echo`   🩹 Patched ${count} broken module(s) in node_modules`;
  }
}

function findFirstFileByName(rootDir, matcher) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function findFilesByName(rootDir, matcher) {
  const matches = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function patchBundledRuntime(outputDir) {
  const replacePatches = [
    {
      label: 'workspace command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist'), /^workspace-.*\.js$/),
      search: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
      replace: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\twindowsHide: true,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
    },
    // Note: OpenClaw 3.31 removed the hash-suffixed agent-scope-*.js, chrome-*.js,
    // and qmd-manager-*.js files from dist/plugin-sdk/. Patches for those spawn
    // sites are no longer needed — the runtime now uses windowsHide natively.
  ];

  let count = 0;
  for (const patch of replacePatches) {
    const target = patch.target();
    if (!target || !fs.existsSync(target)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: target file not found`;
      continue;
    }

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(patch.search)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(patch.search, patch.replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }

  if (count > 0) {
    echo`   🩹 Patched ${count} bundled runtime spawn site(s)`;
  }

  const ptyTargets = findFilesByName(
    path.join(outputDir, 'dist'),
    /^(subagent-registry|reply|pi-embedded)-.*\.js$/,
  );
  const ptyPatches = [
    {
      label: 'pty launcher windowsHide',
      search: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30
\t});`,
      replace: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30,
\t\twindowsHide: true
\t});`,
    },
    {
      label: 'disable pty on windows',
      search: `\t\t\tconst usePty = params.pty === true && !sandbox;`,
      replace: `\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";`,
    },
    {
      label: 'disable approval pty on windows',
      search: `\t\t\t\t\tpty: params.pty === true && !sandbox,`,
      replace: `\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",`,
    },
  ];

  let ptyCount = 0;
  for (const patch of ptyPatches) {
    let matchedAny = false;
    for (const target of ptyTargets) {
      const current = fs.readFileSync(target, 'utf8');
      if (!current.includes(patch.search)) continue;
      matchedAny = true;
      const next = current.replaceAll(patch.search, patch.replace);
      if (next !== current) {
        fs.writeFileSync(target, next, 'utf8');
        ptyCount++;
      }
    }
    if (!matchedAny) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
    }
  }

  if (ptyCount > 0) {
    echo`   🩹 Patched ${ptyCount} bundled PTY site(s)`;
  }
}

patchBrokenModules(outputNodeModules);
patchBundledRuntime(OUTPUT);

// 8. Verify the bundle
const entryExists = fs.existsSync(path.join(OUTPUT, 'openclaw.mjs'));
const distExists = fs.existsSync(path.join(OUTPUT, 'dist', 'entry.js'));

echo``;
echo`✅ Bundle complete: ${OUTPUT}`;
echo`   Unique packages copied: ${copiedCount}`;
echo`   Dev-only packages skipped: ${skippedDevCount}`;
echo`   Duplicate versions skipped: ${skippedDupes}`;
echo`   Total discovered: ${collected.size}`;
echo`   openclaw.mjs: ${entryExists ? '✓' : '✗'}`;
echo`   dist/entry.js: ${distExists ? '✓' : '✗'}`;

if (!entryExists || !distExists) {
  echo`❌ Bundle verification failed!`;
  process.exit(1);
}
