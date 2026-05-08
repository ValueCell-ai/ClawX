/**
 * OpenClaw workspace context utilities.
 *
 * All file I/O is async (fs/promises) to avoid blocking the Electron
 * main thread.
 */
import { access, mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises';
import { constants } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';
import { logger } from './logger';
import { getResourcesDir } from './paths';

const CLAWX_BEGIN = '<!-- clawx:begin -->';
const CLAWX_END = '<!-- clawx:end -->';
const DEFAULT_BOOTSTRAP_FILENAME = 'BOOTSTRAP.md';
const DEFAULT_IDENTITY_FILENAME = 'IDENTITY.md';

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function isCurrentOpenClawPath(p: string): boolean {
  const openclawDir = resolve(join(homedir(), '.openclaw'));
  const workspaceDir = resolve(p);
  return workspaceDir === openclawDir || workspaceDir.startsWith(openclawDir + sep);
}

export function buildDefaultClawXIdentityContent(): string {
  return [
    '# IDENTITY.md - ClawX',
    '',
    '- **Name:** ClawX',
    '- **Creature:** desktop AI assistant',
    '- **Vibe:** concise, capable, and practical',
    '- **Emoji:** 🐾',
    '- **Avatar:**',
    '',
    'ClawX uses a default desktop identity instead of chat-first bootstrap.',
    '',
  ].join('\n');
}

export function isOpenClawIdentityTemplate(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n');
  return normalized.includes('# IDENTITY.md - Who Am I?')
    && normalized.includes('_(pick something you like)_')
    && normalized.includes('- **Name:**')
    && normalized.includes('- **Emoji:**');
}

async function writeFileIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { encoding: 'utf-8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/**
 * Ensure ClawX-managed workspaces have a non-template IDENTITY.md before the
 * Gateway initializes them. Existing custom identities are preserved.
 */
export async function ensureClawXIdentityFile(
  workspaceDir: string,
  options: { createDir?: boolean } = {},
): Promise<void> {
  const resolvedWorkspaceDir = resolve(workspaceDir);
  if (options.createDir) {
    await mkdir(resolvedWorkspaceDir, { recursive: true });
  } else if (!(await fileExists(resolvedWorkspaceDir))) {
    return;
  }

  const identityPath = join(resolvedWorkspaceDir, DEFAULT_IDENTITY_FILENAME);
  const defaultIdentity = buildDefaultClawXIdentityContent();
  let wroteIdentity = await writeFileIfMissing(identityPath, defaultIdentity);

  if (!wroteIdentity) {
    let existing: string;
    try {
      existing = await readFile(identityPath, 'utf-8');
    } catch {
      return;
    }

    if (isOpenClawIdentityTemplate(existing) && existing !== defaultIdentity) {
      await writeFile(identityPath, defaultIdentity, 'utf-8');
      wroteIdentity = true;
    }
  }

  const bootstrapPath = join(resolvedWorkspaceDir, DEFAULT_BOOTSTRAP_FILENAME);
  if (await fileExists(bootstrapPath)) {
    try {
      await unlink(bootstrapPath);
      logger.info(`Removed chat-first bootstrap file from ClawX workspace (${resolvedWorkspaceDir})`);
    } catch {
      logger.warn(`Failed to remove chat-first bootstrap file: ${bootstrapPath}`);
    }
  } else if (wroteIdentity) {
    logger.info(`Seeded default ClawX identity for workspace (${resolvedWorkspaceDir})`);
  }
}

export async function ensureClawXDefaultIdentity(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const { dir: workspaceDir, waitForGatewaySeed } of workspaceDirs) {
    await ensureClawXIdentityFile(workspaceDir, { createDir: waitForGatewaySeed });
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

type WorkspaceDir = {
  dir: string;
  /**
   * Only the default workspace is expected to be seeded during Gateway startup.
   * Other agent workspaces may remain empty until that agent is actually used,
   * so missing bootstrap files there should not keep a startup retry loop alive.
   */
  waitForGatewaySeed: boolean;
};

/**
 * Collect all unique workspace directories from the openclaw config.
 */
async function resolveAllWorkspaceDirs(): Promise<WorkspaceDir[]> {
  const openclawDir = join(homedir(), '.openclaw');
  const dirs = new Map<string, WorkspaceDir>();
  const addDir = (dir: string, waitForGatewaySeed: boolean) => {
    const existing = dirs.get(dir);
    dirs.set(dir, {
      dir,
      waitForGatewaySeed: waitForGatewaySeed || existing?.waitForGatewaySeed === true,
    });
  };

  const configPath = join(openclawDir, 'openclaw.json');
  try {
    if (await fileExists(configPath)) {
      const config = JSON.parse(await readFile(configPath, 'utf-8'));

      const defaultWs = config?.agents?.defaults?.workspace;
      let hasDefaultWorkspace = false;
      if (typeof defaultWs === 'string' && defaultWs.trim()) {
        addDir(defaultWs.replace(/^~/, homedir()), true);
        hasDefaultWorkspace = true;
      }

      const agents = config?.agents?.list;
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          const ws = agent?.workspace;
          if (typeof ws === 'string' && ws.trim()) {
            const isMainDefault =
              agent?.default === true || (agent?.id === 'main' && !hasDefaultWorkspace);
            addDir(ws.replace(/^~/, homedir()), isMainDefault);
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
    addDir(join(openclawDir, 'workspace'), true);
  }

  return [...dirs.values()];
}

// ── Bootstrap file repair ────────────────────────────────────────

/**
 * Detect and remove bootstrap .md files that contain only ClawX markers
 * with no meaningful OpenClaw content outside them.
 */
export async function repairClawXOnlyBootstrapFiles(): Promise<void> {
  const workspaceDirs = await resolveAllWorkspaceDirs();
  for (const { dir: workspaceDir } of workspaceDirs) {
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
 * Merge ClawX context snippets into workspace bootstrap files that already
 * exist on disk. Missing files are only retryable for startup-owned workspaces.
 */
type MergeResult = {
  missing: number;
  retryableMissing: number;
};

type EnsureClawXContextOptions = {
  /**
   * Startup should only wait for the default workspace. Explicit provisioning
   * flows can opt in so a freshly-created agent workspace gets patched after
   * the Gateway seeds it.
   */
  waitForAllConfiguredWorkspaces?: boolean;
};

async function mergeClawXContextOnce(options: EnsureClawXContextOptions = {}): Promise<MergeResult> {
  const contextDir = join(getResourcesDir(), 'context');
  if (!(await fileExists(contextDir))) {
    logger.debug('ClawX context directory not found, skipping context merge');
    return { missing: 0, retryableMissing: 0 };
  }

  let files: string[];
  try {
    files = (await readdir(contextDir)).filter((f) => f.endsWith('.clawx.md'));
  } catch {
    return { missing: 0, retryableMissing: 0 };
  }

  const workspaceDirs = await resolveAllWorkspaceDirs();
  let missing = 0;
  let retryableMissing = 0;

  for (const { dir: workspaceDir, waitForGatewaySeed } of workspaceDirs) {
    const workspaceExists = await fileExists(workspaceDir);
    const shouldWaitForSeed =
      (waitForGatewaySeed || options.waitForAllConfiguredWorkspaces === true)
      && (workspaceExists || isCurrentOpenClawPath(workspaceDir));

    if (!workspaceExists) {
      if (shouldWaitForSeed) {
        retryableMissing += files.length;
      }
      missing += files.length;
      continue;
    }

    for (const file of files) {
      const targetName = file.replace('.clawx.md', '.md');
      const targetPath = join(workspaceDir, targetName);

      if (!(await fileExists(targetPath))) {
        missing++;
        if (shouldWaitForSeed) {
          retryableMissing++;
        }
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

  return { missing, retryableMissing };
}

const RETRY_INTERVAL_MS = 2000;
const MAX_RETRIES = 5;
let ensureClawXContextPromise: Promise<void> | null = null;
let ensureClawXContextWaitsForAll = false;

/**
 * Ensure ClawX context snippets are merged into the openclaw workspace
 * bootstrap files.
 */
export async function ensureClawXContext(options: EnsureClawXContextOptions = {}): Promise<void> {
  if (ensureClawXContextPromise) {
    if (options.waitForAllConfiguredWorkspaces && !ensureClawXContextWaitsForAll) {
      return ensureClawXContextPromise.then(() => ensureClawXContext(options));
    }
    return ensureClawXContextPromise;
  }

  ensureClawXContextWaitsForAll = options.waitForAllConfiguredWorkspaces === true;
  ensureClawXContextPromise = runEnsureClawXContext(options).finally(() => {
    ensureClawXContextPromise = null;
    ensureClawXContextWaitsForAll = false;
  });
  return ensureClawXContextPromise;
}

async function runEnsureClawXContext(options: EnsureClawXContextOptions): Promise<void> {
  let result = await mergeClawXContextOnce(options);
  if (result.retryableMissing === 0) {
    if (result.missing > 0) {
      logger.debug(`ClawX context merge skipped ${result.missing} non-ready file(s)`);
    }
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    result = await mergeClawXContextOnce(options);
    if (result.retryableMissing === 0) {
      logger.info(`ClawX context merge completed after ${attempt} retry(ies)`);
      return;
    }
    logger.debug(`ClawX context merge: ${result.retryableMissing} startup file(s) still missing (retry ${attempt}/${MAX_RETRIES})`);
  }

  logger.warn(`ClawX context merge: ${result.retryableMissing} startup file(s) still missing after ${MAX_RETRIES} retries`);
}
