/**
 * OpenClaw workspace context utilities.
 *
 * All file I/O is async (fs/promises) to avoid blocking the Electron
 * main thread.
 */
import { access, readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger';
import { getResourcesDir } from './paths';

const CLAWX_BEGIN = '<!-- clawx:begin -->';
const CLAWX_END = '<!-- clawx:end -->';

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

// ── Pure helpers (no I/O) ────────────────────────────────────────

/**
 * Merge a ClawX context section into an existing file's content.
 * If markers already exist, replaces the section in-place.
 * Otherwise appends it at the end.
 */
export function mergeClawXSection(existing: string, section: string): string {
  const wrapped = `${CLAWX_BEGIN}\n${section.trim()}\n${CLAWX_END}`;
  const beginIdx = existing.indexOf(CLAWX_BEGIN);
  const endIdx = existing.indexOf(CLAWX_END);
  if (beginIdx !== -1 && endIdx !== -1) {
    return existing.slice(0, beginIdx) + wrapped + existing.slice(endIdx + CLAWX_END.length);
  }
  return existing.trimEnd() + '\n\n' + wrapped + '\n';
}

/**
 * Strip the "## First Run" section from workspace AGENTS.md content.
 * This section is seeded by the OpenClaw Gateway but is unnecessary
 * for ClawX-managed workspaces.  Removes everything from the heading
 * line until the next markdown heading (any level) or end of content.
 */
export function stripFirstRunSection(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipping = false;
  let consumedFirstParagraph = false;
  let seenBlankAfterParagraph = false;

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    const trimmed = line.trim();

    if (line.trim() === '## First Run') {
      skipping = true;
      consumedFirstParagraph = false;
      seenBlankAfterParagraph = false;
      continue;
    }

    if (skipping) {
      // A new heading marks the end of the First Run block.
      if (isHeading) {
        skipping = false;
      } else if (!consumedFirstParagraph) {
        // Drop leading blank lines and the first guidance paragraph.
        if (trimmed.length === 0) {
          continue;
        }
        consumedFirstParagraph = true;
        continue;
      } else if (!seenBlankAfterParagraph) {
        // Keep consuming the same paragraph until a blank line appears.
        if (trimmed.length === 0) {
          seenBlankAfterParagraph = true;
          continue;
        }
        continue;
      } else {
        // After paragraph + blank line, preserve subsequent body content.
        if (trimmed.length === 0) {
          continue;
        }
        skipping = false;
      }
    }

    if (!skipping) {
      result.push(line);
    }
  }

  // Collapse any resulting triple+ blank lines into double
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Workspace directory resolution ───────────────────────────────

/**
 * Collect all unique workspace directories from the openclaw config:
 * the defaults workspace, each agent's workspace, and any workspace-*
 * directories that already exist under ~/.openclaw/.
 */
async function resolveAllWorkspaceDirs(): Promise<string[]> {
  const openclawDir = join(homedir(), '.openclaw');
  const dirs = new Set<string>();

  const configPath = join(openclawDir, 'openclaw.json');
  try {
    if (await fileExists(configPath)) {
      const config = JSON.parse(await readFile(configPath, 'utf-8'));

      const defaultWs = config?.agents?.defaults?.workspace;
      if (typeof defaultWs === 'string' && defaultWs.trim()) {
        dirs.add(defaultWs.replace(/^~/, homedir()));
      }

      const agents = config?.agents?.list;
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          const ws = agent?.workspace;
          if (typeof ws === 'string' && ws.trim()) {
            dirs.add(ws.replace(/^~/, homedir()));
          }
        }
      }
    }
  } catch {
    // ignore config parse errors
  }

  // We intentionally do NOT scan ~/.openclaw/ for any directory starting
  // with 'workspace'. Doing so causes a race condition where a recently deleted
  // agent's workspace (e.g., workspace-code23) is found and resuscitated by
  // the context merge routine before its deletion finishes. Only workspaces
  // explicitly declared in openclaw.json should be seeded.

  if (dirs.size === 0) {
    dirs.add(join(openclawDir, 'workspace'));
  }

  return [...dirs];
}

// ── Bootstrap file repair ────────────────────────────────────────

/**
 * Detect and remove bootstrap .md files that contain only ClawX markers
 * with no meaningful OpenClaw content outside them.
 */
export async function repairClawXOnlyBootstrapFiles(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const workspaceDir of workspaceDirs) {
    if (!(await fileExists(workspaceDir))) continue;

    let entries: string[];
    try {
      entries = (await readdir(workspaceDir)).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of entries) {
      const filePath = join(workspaceDir, file);
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const beginIdx = content.indexOf(CLAWX_BEGIN);
      const endIdx = content.indexOf(CLAWX_END);
      if (beginIdx === -1 || endIdx === -1) continue;

      const before = content.slice(0, beginIdx).trim();
      const after = content.slice(endIdx + CLAWX_END.length).trim();
      if (before === '' && after === '') {
        try {
          await unlink(filePath);
          logger.info(`Removed ClawX-only bootstrap file for re-seeding: ${file} (${workspaceDir})`);
        } catch {
          logger.warn(`Failed to remove ClawX-only bootstrap file: ${filePath}`);
        }
      }
    }
  }
}

// ── Context merging ──────────────────────────────────────────────

/**
 * Merge ClawX context snippets into workspace bootstrap files that
 * already exist on disk.  Returns the number of target files that were
 * skipped because they don't exist yet.
 */
async function mergeClawXContextOnce(): Promise<number> {
  const contextDir = join(getResourcesDir(), 'context');
  if (!(await fileExists(contextDir))) {
    logger.debug('ClawX context directory not found, skipping context merge');
    return 0;
  }

  let files: string[];
  try {
    files = (await readdir(contextDir)).filter((f) => f.endsWith('.clawx.md'));
  } catch {
    return 0;
  }

  const workspaceDirs = await resolveAllWorkspaceDirs();
  let skipped = 0;

  for (const workspaceDir of workspaceDirs) {
    await ensureDir(workspaceDir);

    for (const file of files) {
      const targetName = file.replace('.clawx.md', '.md');
      const targetPath = join(workspaceDir, targetName);

      if (!(await fileExists(targetPath))) {
        logger.debug(`Skipping ${targetName} in ${workspaceDir} (file does not exist yet, will be seeded by gateway)`);
        skipped++;
        continue;
      }

      const section = await readFile(join(contextDir, file), 'utf-8');
      const originalExisting = await readFile(targetPath, 'utf-8');
      let existing = originalExisting;

      // Strip unwanted Gateway-seeded sections before merging
      if (targetName === 'AGENTS.md') {
        const stripped = stripFirstRunSection(existing);
        if (stripped !== existing) {
          existing = stripped;
          logger.info(`Stripped First Run section from ${targetName} (${workspaceDir})`);
        }
      }

      const merged = mergeClawXSection(existing, section);
      // Compare against on-disk content so we persist changes even when only
      // First Run stripping happened and the ClawX section stayed identical.
      if (merged !== originalExisting) {
        await writeFile(targetPath, merged, 'utf-8');
        logger.info(`Merged ClawX context into ${targetName} (${workspaceDir})`);
      }
    }
  }

  return skipped;
}

const RETRY_INTERVAL_MS = 2000;
const MAX_RETRIES = 15;

/**
 * Ensure ClawX context snippets are merged into the openclaw workspace
 * bootstrap files.
 */
export async function ensureClawXContext(): Promise<void> {
  let skipped = await mergeClawXContextOnce();
  if (skipped === 0) return;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    skipped = await mergeClawXContextOnce();
    if (skipped === 0) {
      logger.info(`ClawX context merge completed after ${attempt} retry(ies)`);
      return;
    }
    logger.debug(`ClawX context merge: ${skipped} file(s) still missing (retry ${attempt}/${MAX_RETRIES})`);
  }

  logger.warn(`ClawX context merge: ${skipped} file(s) still missing after ${MAX_RETRIES} retries`);
}
