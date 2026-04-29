/**
 * Pre-launch cleanup for stray skill symlinks under ~/.openclaw/skills.
 *
 * Background: since openclaw commit 253e159700 ("fix: harden workspace skill
 * path containment"), the Gateway rejects any candidate under a skills root
 * whose realpath escapes that root, logging a noisy
 *   `Skipping escaped skill path outside its configured root.
 *    reason=symlink-escape source=openclaw-managed ...`
 * warning per offending entry on every start.
 *
 * A common offender is one-shot install scripts that drop symlinks into
 * ~/.openclaw/skills/<name> pointing at ~/.agents/skills/<name>.  The skills
 * still load via the separate `agents-skills-personal` source (which scans
 * ~/.agents/skills directly), so the symlinks under ~/.openclaw/skills are
 * pure log noise — and a duplicate entry that the loader can never accept.
 *
 * This helper is invoked before each Gateway launch to remove those
 * specific symlinks.  Scope is intentionally narrow:
 *   - source dir: ~/.openclaw/skills (resolved via getOpenClawSkillsDir())
 *   - target dir: ~/.agents/skills only (NOT the broader ~/.agents tree)
 * Symlinks whose realpath resolves anywhere else under ~/.agents (e.g.
 * ~/.agents/tools/foo) or to unrelated locations are left untouched.
 *
 * Removal uses fs.rmSync({ force: true }) rather than fs.unlinkSync so that
 * Windows directory symlinks and junctions (the form that non-admin Windows
 * installs end up creating) are deleted correctly.  unlinkSync raises EPERM
 * on those on Windows.
 *
 * This is a transitional workaround.  Once openclaw/openclaw#59219 lands and
 * the loader stops rejecting managed-source symlinks whose realpath escapes
 * the managed root, this helper can be removed entirely.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  type Dirent,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { getOpenClawSkillsDir } from '../utils/paths';
import { logger } from '../utils/logger';

export interface CleanupOptions {
  /** Override for ~/.openclaw/skills (mainly for tests). */
  skillsDir?: string;
  /** Override for ~/.agents/skills (mainly for tests). */
  agentsDir?: string;
}

export interface CleanupResult {
  /** Symlink names that were unlinked from the skills dir. */
  removed: string[];
  /** Total number of symlink entries that were inspected. */
  examined: number;
}

function defaultSkillsDir(): string {
  return getOpenClawSkillsDir();
}

function defaultAgentsDir(): string {
  return path.join(homedir(), '.agents', 'skills');
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

export function cleanupAgentsSymlinkedSkills(opts: CleanupOptions = {}): CleanupResult {
  const skillsDir = opts.skillsDir ?? defaultSkillsDir();
  const agentsDir = opts.agentsDir ?? defaultAgentsDir();
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

    if (!isInside(agentsRealRoot, realTarget)) continue;

    try {
      // rmSync({ force: true }) handles file symlinks, directory symlinks,
      // and Windows junctions uniformly.  unlinkSync would raise EPERM on
      // directory symlinks/junctions on Windows.
      rmSync(entryPath, { force: true });
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[skills-cleanup] Failed to remove ${entryPath}:`, err);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[skills-cleanup] Removed ${result.removed.length} stray skill symlink(s) ` +
        `under ${skillsDir} that resolved into ${agentsRealRoot} ` +
        `(workaround for openclaw/openclaw#59219): ` +
        result.removed.join(', '),
    );
  } else if (result.examined > 0) {
    logger.debug(
      `[skills-cleanup] Examined ${result.examined} symlink(s) under ${skillsDir}; ` +
        `none resolved into ${agentsRealRoot}`,
    );
  }

  return result;
}
