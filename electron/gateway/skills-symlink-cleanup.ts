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
 * specific symlinks.  Only symlinks whose realpath resolves into ~/.agents
 * are removed; in-tree symlinks, real directories, and symlinks to other
 * locations are left untouched.
 *
 * Tracking the upstream fix: openclaw/openclaw#59219.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  type Dirent,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger';

export interface CleanupOptions {
  /** Override for ~/.openclaw/skills (mainly for tests). */
  skillsDir?: string;
  /** Override for ~/.agents (mainly for tests). */
  agentsDir?: string;
}

export interface CleanupResult {
  /** Symlink names that were unlinked from the skills dir. */
  removed: string[];
  /** Total number of symlink entries that were inspected. */
  examined: number;
}

function defaultSkillsDir(): string {
  return path.join(homedir(), '.openclaw', 'skills');
}

function defaultAgentsDir(): string {
  return path.join(homedir(), '.agents');
}

function resolveAgentsRealRoot(agentsDir: string): string {
  try {
    if (existsSync(agentsDir)) {
      return realpathSync(agentsDir);
    }
  } catch {
    // Fall through to the unresolved candidate; if the dir cannot be
    // realpath'd we still compare against its lexical form below.
  }
  return path.resolve(agentsDir);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
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
      unlinkSync(entryPath);
      result.removed.push(entry.name);
    } catch (err) {
      logger.warn(`[skills-cleanup] Failed to remove ${entryPath}:`, err);
    }
  }

  if (result.removed.length > 0) {
    logger.info(
      `[skills-cleanup] Removed ${result.removed.length} stray skill symlink(s) ` +
        `under ${skillsDir} that resolved into ${agentsRealRoot}: ` +
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
