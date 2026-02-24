import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger';
import { getResourcesDir } from './paths';

const CLAWX_BEGIN = '<!-- clawx:begin -->';
const CLAWX_END = '<!-- clawx:end -->';

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
 * Collect all unique workspace directories from the openclaw config:
 * the defaults workspace, each agent's workspace, and any workspace-*
 * directories that already exist under ~/.openclaw/.
 */
function resolveAllWorkspaceDirs(): string[] {
  const openclawDir = join(homedir(), '.openclaw');
  const dirs = new Set<string>();

  const configPath = join(openclawDir, 'openclaw.json');
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

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

  try {
    for (const entry of readdirSync(openclawDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('workspace')) {
        dirs.add(join(openclawDir, entry.name));
      }
    }
  } catch {
    // ignore read errors
  }

  if (dirs.size === 0) {
    dirs.add(join(openclawDir, 'workspace'));
  }

  return [...dirs];
}

/**
 * Ensure ClawX context snippets are merged into the openclaw workspace
 * bootstrap files. Reads `*.clawx.md` templates from resources/context/
 * and injects them as marker-delimited sections into the corresponding
 * workspace `.md` files (e.g. AGENTS.clawx.md -> AGENTS.md).
 *
 * Iterates over every discovered agent workspace so all agents receive
 * the ClawX context regardless of which one is active.
 */
export function ensureClawXContext(): void {
  const contextDir = join(getResourcesDir(), 'context');
  if (!existsSync(contextDir)) {
    logger.debug('ClawX context directory not found, skipping context merge');
    return;
  }

  let files: string[];
  try {
    files = readdirSync(contextDir).filter((f) => f.endsWith('.clawx.md'));
  } catch {
    return;
  }

  const workspaceDirs = resolveAllWorkspaceDirs();

  for (const workspaceDir of workspaceDirs) {
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    for (const file of files) {
      const targetName = file.replace('.clawx.md', '.md');
      const targetPath = join(workspaceDir, targetName);
      const section = readFileSync(join(contextDir, file), 'utf-8');

      let existing = '';
      if (existsSync(targetPath)) {
        existing = readFileSync(targetPath, 'utf-8');
      }

      const merged = mergeClawXSection(existing, section);
      if (merged !== existing) {
        writeFileSync(targetPath, merged, 'utf-8');
        logger.info(`Merged ClawX context into ${targetName} (${workspaceDir})`);
      }
    }
  }
}
