/**
 * Pre-launch cleanup for stray skill symlinks under OpenClaw skill roots.
 *
 * Background: since openclaw commit 253e159700 ("fix: harden workspace skill
 * path containment"), the Gateway rejects any candidate under a skills root
 * whose realpath escapes that root, logging a noisy
 *   `Skipping escaped skill path outside its configured root.
 *    reason=symlink-escape source=openclaw-managed ...`
 * warning per offending entry on every start.
 *
 * Common offenders are one-shot install scripts that drop symlinks into:
 *   - ~/.openclaw/skills/<name> -> ~/.agents/skills/<name>
 *   - ~/.openclaw/workspace/skills/<name> -> ~/.openclaw/workspace/.agents/skills/<name>
 *   - ~/.openclaw/skills/<name> -> ~/workspace/<repo>/skills/<name>
 * The hardened loader rejects these because their realpath escapes the
 * configured managed root, so they are pure log noise — entries that the
 * loader can never accept from this root.
 *
 * This helper is invoked before each Gateway launch to remove those
 * specific symlinks.  Scope is intentionally narrow:
 *   - source dirs: ~/.openclaw/skills and ~/.openclaw/workspace/skills
 *   - target dirs: anything outside the matching managed skills root
 * Symlinks whose realpath stays inside the same managed skills root are left
 * untouched.
 *
 * Removal uses fs.rmSync({ force: true, recursive: true }) rather than
 * fs.unlinkSync so that directory symlinks and Windows junctions (the form
 * that non-admin Windows installs end up creating) are deleted correctly.
 * unlinkSync raises EPERM on those on Windows, and rmSync without recursive
 * can reject directory symlinks on some platforms.
 *
 * This is a transitional workaround.  Once openclaw/openclaw#59219 lands and
 * the loader stops rejecting managed-source symlinks whose realpath escapes
 * the managed root, this helper can be removed entirely.
 */
import {
  existsSync,
  lstatSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  type Dirent,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getOpenClawConfigDir, getOpenClawResolvedDir, getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';

export interface CleanupOptions {
  /** Override for ~/.openclaw/skills (mainly for tests). */
  skillsDir?: string;
  /** Override for ~/.agents/skills (mainly for tests/log context). */
  agentsDir?: string;
  /** Override for ~/.openclaw/workspace/skills (mainly for tests). */
  workspaceSkillsDir?: string;
  /** Override for ~/.openclaw/workspace/.agents/skills (mainly for tests). */
  workspaceAgentsDir?: string;
}

export interface CleanupResult {
  /** Symlink names that were unlinked from the skills dir. */
  removed: string[];
  /** Total number of symlink entries that were inspected. */
  examined: number;
}

export interface PluginRuntimeDepsCleanupOptions {
  /** Override for ~/.openclaw/plugin-runtime-deps (mainly for tests). */
  runtimeDepsDir?: string;
  /** Override for the current bundled OpenClaw package dir (mainly for tests). */
  currentOpenClawDir?: string;
}

function defaultSkillsDir(): string {
  return getOpenClawSkillsDir();
}

function defaultAgentsDir(): string {
  return path.join(homedir(), '.agents', 'skills');
}

function defaultWorkspaceSkillsDir(): string {
  return path.join(getOpenClawConfigDir(), 'workspace', 'skills');
}

function defaultWorkspaceAgentsDir(): string {
  return path.join(getOpenClawConfigDir(), 'workspace', '.agents', 'skills');
}

function defaultPluginRuntimeDepsDir(): string {
  return path.join(getOpenClawConfigDir(), 'plugin-runtime-deps');
}

/**
 * Resolve the agents skills directory to its real path.  When the directory
 * itself does not exist yet (fresh install), fall back to realpath'ing its
 * parent and re-appending the basename so a `~/.agents -> /opt/agents`
 * indirection is still honored.  As a final fallback returns the lexical
 * resolved path.
 */
function resolveAgentsRealRoot(agentsDir: string): string {
  if (existsSync(agentsDir)) {
    try {
      return realpathSync(agentsDir);
    } catch {
      // fall through
    }
  }
  const parent = path.dirname(agentsDir);
  const tail = path.basename(agentsDir);
  if (parent && parent !== agentsDir && existsSync(parent)) {
    try {
      return path.join(realpathSync(parent), tail);
    } catch {
      // fall through
    }
  }
  return path.resolve(agentsDir);
}

/**
 * Lower-case path strings on Win32 only so the `path.relative` byte-wise
 * comparison aligns with NTFS case-insensitive semantics.  No-op elsewhere.
 */
function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(normalizeForCompare(parent), normalizeForCompare(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveSymlinkTarget(linkPath: string): string | null {
  try {
    const target = readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), target);
  } catch {
    return null;
  }
}

function looksLikeOpenClawPackagePath(candidate: string): boolean {
  const normalized = candidate.replace(/\\/g, '/');
  return /\/node_modules(?:\/\.pnpm\/[^/]+\/node_modules)?\/openclaw(?:\/|$)/.test(normalized);
}

function resolveCurrentOpenClawRoots(currentOpenClawDir: string): string[] {
  const roots = new Set<string>([path.resolve(currentOpenClawDir)]);
  try {
    roots.add(realpathSync(currentOpenClawDir));
  } catch {
    // fall through
  }
  return Array.from(roots);
}

export function cleanupAgentsSymlinkedSkills(opts: CleanupOptions = {}): CleanupResult {
  const hasMainOverrides = opts.skillsDir !== undefined || opts.agentsDir !== undefined;
  const hasWorkspaceOverrides =
    opts.workspaceSkillsDir !== undefined || opts.workspaceAgentsDir !== undefined;
  const roots = [
    {
      skillsDir: opts.skillsDir ?? defaultSkillsDir(),
      agentsDir: opts.agentsDir ?? defaultAgentsDir(),
    },
  ];

  if (!hasMainOverrides || hasWorkspaceOverrides) {
    roots.push({
      skillsDir: opts.workspaceSkillsDir ?? defaultWorkspaceSkillsDir(),
      agentsDir: opts.workspaceAgentsDir ?? defaultWorkspaceAgentsDir(),
    });
  }

  const result: CleanupResult = { removed: [], examined: 0 };
  const seenRoots = new Set<string>();

  for (const root of roots) {
    const rootKey = `${path.resolve(root.skillsDir)}\0${path.resolve(root.agentsDir)}`;
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);

    const rootResult = cleanupSkillsDir(root.skillsDir, root.agentsDir);
    result.removed.push(...rootResult.removed);
    result.examined += rootResult.examined;
  }

  return result;
}

/**
 * Remove stale OpenClaw plugin runtime dependency cache roots.
 *
 * OpenClaw can materialize `~/.openclaw/plugin-runtime-deps/openclaw-*` as a
 * symlink tree back into the package's `dist` files.  After app upgrades or
 * worktree switches those symlinks can point at an old `node_modules/openclaw`
 * path.  The Gateway may then spend a long time synchronously opening/copying
 * old runtime files during plugin setup, which blocks RPC readiness.
 *
 * Scope is intentionally narrow: only immediate cache roots named `openclaw-*`
 * are removed, and only when a symlink inside points at an OpenClaw package
 * path outside the current bundled package.  The cache is regenerated by
 * OpenClaw on demand.
 */
export function cleanupStalePluginRuntimeDeps(
  opts: PluginRuntimeDepsCleanupOptions = {},
): CleanupResult {
  const runtimeDepsDir = opts.runtimeDepsDir ?? defaultPluginRuntimeDepsDir();
  const currentRoots = resolveCurrentOpenClawRoots(opts.currentOpenClawDir ?? getOpenClawResolvedDir());
  const result: CleanupResult = { removed: [], examined: 0 };

  if (!existsSync(runtimeDepsDir)) {
    return result;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(runtimeDepsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    logger.warn(`[plugin-runtime-deps-cleanup] Failed to list ${runtimeDepsDir}:`, err);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('openclaw-')) {
      continue;
    }

    const cacheRoot = path.join(runtimeDepsDir, entry.name);
    const scan = scanRuntimeDepsRootForStaleOpenClawSymlink(cacheRoot, currentRoots);
    result.examined += scan.examined;
    if (!scan.stale) {
      continue;
    }

    try {
      rmSync(cacheRoot, { force: true, recursive: true });
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[plugin-runtime-deps-cleanup] Failed to remove ${cacheRoot}:`, err);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[plugin-runtime-deps-cleanup] Removed ${result.removed.length} stale OpenClaw runtime cache root(s): ` +
        result.removed.join(', '),
    );
  }

  return result;
}

function scanRuntimeDepsRootForStaleOpenClawSymlink(
  cacheRoot: string,
  currentOpenClawRoots: string[],
): { stale: boolean; examined: number } {
  const stack = [cacheRoot];
  let examined = 0;
  const maxEntries = 5000;

  while (stack.length > 0 && examined < maxEntries) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (examined >= maxEntries) break;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      let isSymlink = entry.isSymbolicLink();
      if (!isSymlink) {
        try {
          isSymlink = lstatSync(entryPath).isSymbolicLink();
        } catch {
          continue;
        }
      }
      if (!isSymlink) continue;

      examined++;
      const target = resolveSymlinkTarget(entryPath);
      if (!target || !looksLikeOpenClawPackagePath(target)) {
        continue;
      }

      const pointsAtCurrentOpenClaw = currentOpenClawRoots.some((root) => isInside(root, target));
      if (!pointsAtCurrentOpenClaw) {
        return { stale: true, examined };
      }
    }
  }

  return { stale: false, examined };
}

function cleanupSkillsDir(skillsDir: string, agentsDir: string): CleanupResult {
  const result: CleanupResult = { removed: [], examined: 0 };
  if (!existsSync(skillsDir)) {
    return result;
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (err) {
    logger.warn(`[skills-cleanup] Failed to list ${skillsDir}:`, err);
    return result;
  }

  const agentsRealRoot = resolveAgentsRealRoot(agentsDir);
  const skillsRealRoot = resolveAgentsRealRoot(skillsDir);

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);

    let isSymlink = entry.isSymbolicLink();
    if (!isSymlink) {
      try {
        isSymlink = lstatSync(entryPath).isSymbolicLink();
      } catch {
        continue;
      }
    }
    if (!isSymlink) continue;

    result.examined++;

    let realTarget: string;
    try {
      realTarget = realpathSync(entryPath);
    } catch {
      continue;
    }

    if (isInside(skillsRealRoot, realTarget)) continue;

    try {
      // rmSync handles file symlinks, directory symlinks, and Windows
      // junctions uniformly.  unlinkSync would raise EPERM on directory
      // symlinks/junctions on Windows.
      rmSync(entryPath, { force: true, recursive: true });
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[skills-cleanup] Failed to remove ${entryPath}:`, err);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[skills-cleanup] Removed ${result.removed.length} stray skill symlink(s) ` +
        `under ${skillsDir} that escaped managed root ${skillsRealRoot} ` +
        `(workaround for openclaw/openclaw#59219): ` +
        result.removed.join(', '),
    );
  } else if (result.examined > 0) {
    logger.debug(
      `[skills-cleanup] Examined ${result.examined} symlink(s) under ${skillsDir}; ` +
        `none escaped managed root (agents context: ${agentsRealRoot})`,
    );
  }

  return result;
}
