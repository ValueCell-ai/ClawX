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
    {
      rel: '@mariozechner/pi-coding-agent/dist/core/bash-executor.js',
      search: `        const child = spawn(shell, [...args, command], {
            detached: true,
            env: getShellEnv(),
            stdio: ["ignore", "pipe", "pipe"],
        });`,
      replace: `        const child = spawn(shell, [...args, command], {
            detached: true,
            env: getShellEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });`,
    },
    {
      rel: '@mariozechner/pi-coding-agent/dist/core/exec.js',
      search: `        const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });`,
      replace: `        const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });`,
    },
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
    {
      label: 'agent scope command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^agent-scope-.*\.js$/),
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
    {
      label: 'chrome launcher',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^chrome-.*\.js$/),
      search: `\t\treturn spawn(exe.path, args, {
\t\t\tstdio: "pipe",
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tHOME: os.homedir()
\t\t\t}
\t\t});`,
      replace: `\t\treturn spawn(exe.path, args, {
\t\t\tstdio: "pipe",
\t\t\twindowsHide: true,
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tHOME: os.homedir()
\t\t\t}
\t\t});`,
    },
    {
      label: 'qmd runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^qmd-manager-.*\.js$/),
      search: `\t\t\tconst child = spawn(resolveWindowsCommandShim(this.qmd.command), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir
\t\t\t});`,
      replace: `\t\t\tconst child = spawn(resolveWindowsCommandShim(this.qmd.command), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir,
\t\t\t\twindowsHide: true
\t\t\t});`,
    },
    {
      label: 'mcporter runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^qmd-manager-.*\.js$/),
      search: `\t\t\tconst child = spawn(resolveWindowsCommandShim("mcporter"), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir
\t\t\t});`,
      replace: `\t\t\tconst child = spawn(resolveWindowsCommandShim("mcporter"), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir,
\t\t\t\twindowsHide: true
\t\t\t});`,
    },
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
