import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { expandPath, getOpenClawDir, getResourcesDir } from './paths';

export type QuickAccessSkillSource = 'workspace' | 'openclaw' | 'system';

export interface QuickAccessSkill {
  name: string;
  description: string;
  source: QuickAccessSkillSource;
  sourceLabel: string;
  manifestPath: string;
  baseDir: string;
}

type QuickAccessScanParams = {
  workspace?: string | null;
  agentDir?: string | null;
  openClawDir?: string | null;
  systemRoots?: string[];
};

type SourceDescriptor = {
  source: QuickAccessSkillSource;
  sourceLabel: string;
  priority: number;
  roots: string[];
};

const MAX_SKILL_FILE_BYTES = 256_000;

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const normalized = resolve(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function parseFrontmatterDescription(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return null;
  const frontmatter = content.slice(3, endIndex);
  const match = frontmatter.match(/^\s*description\s*:\s*(.+)\s*$/m);
  if (!match) return null;
  return match[1]?.trim().replace(/^['"]|['"]$/g, '') || null;
}

function parseBodyDescription(content: string): string {
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterClosed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();

    if (index === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    if (!trimmed) continue;
    if (frontmatterClosed && trimmed === '---') continue;
    if (/^#{1,6}\s+/.test(trimmed)) continue;
    return trimmed.replace(/^[-*]\s+/, '');
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      return trimmed.replace(/^#{1,6}\s+/, '');
    }
  }

  return 'No description available.';
}

async function readSkillDescription(manifestPath: string): Promise<string> {
  const fileStat = await stat(manifestPath);
  if (fileStat.size > MAX_SKILL_FILE_BYTES) {
    return 'Description unavailable (SKILL.md exceeds size limit).';
  }
  const content = await readFile(manifestPath, 'utf-8');
  return parseFrontmatterDescription(content) || parseBodyDescription(content);
}

async function resolveSafeRoot(root: string): Promise<string | null> {
  if (!(await pathExists(root))) return null;
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return null;
    return await realpath(root);
  } catch {
    return null;
  }
}

async function inspectSkillDir(params: {
  source: QuickAccessSkillSource;
  sourceLabel: string;
  priority: number;
  root: string;
  rootRealPath: string;
  skillDir: string;
}): Promise<QuickAccessSkill | null> {
  const manifestPath = join(params.skillDir, 'SKILL.md');
  if (!(await pathExists(manifestPath))) return null;

  try {
    const skillDirRealPath = await realpath(params.skillDir);
    if (!isInsideRoot(params.rootRealPath, skillDirRealPath)) {
      return null;
    }
    const description = await readSkillDescription(manifestPath);
    return {
      name: basename(skillDirRealPath),
      description,
      source: params.source,
      sourceLabel: params.sourceLabel,
      manifestPath,
      baseDir: skillDirRealPath,
    };
  } catch {
    return null;
  }
}

async function scanRoot(descriptor: Omit<SourceDescriptor, 'roots'> & { root: string }): Promise<QuickAccessSkill[]> {
  const rootRealPath = await resolveSafeRoot(descriptor.root);
  if (!rootRealPath) return [];

  const skillDirs = new Set<string>();
  const rootManifest = join(descriptor.root, 'SKILL.md');
  if (await pathExists(rootManifest)) {
    skillDirs.add(descriptor.root);
  }

  try {
    const entries = await readdir(descriptor.root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const entryPath = join(descriptor.root, entry.name);
      if (entry.isDirectory()) {
        skillDirs.add(entryPath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          const symlinkStat = await lstat(entryPath);
          if (symlinkStat.isSymbolicLink()) {
            const resolved = await stat(entryPath);
            if (resolved.isDirectory()) {
              skillDirs.add(entryPath);
            }
          }
        } catch {
          // Ignore broken symlinks and unreadable entries.
        }
      }
    }
  } catch {
    return [];
  }

  const items = await Promise.all(
    [...skillDirs].map((skillDir) =>
      inspectSkillDir({
        source: descriptor.source,
        sourceLabel: descriptor.sourceLabel,
        priority: descriptor.priority,
        root: descriptor.root,
        rootRealPath,
        skillDir,
      }),
    ),
  );

  return items.filter((item): item is QuickAccessSkill => item != null);
}

function resolveSystemRoots(agentDir?: string | null, explicitRoots?: string[]): string[] {
  if (explicitRoots && explicitRoots.length > 0) {
    return dedupePaths(explicitRoots);
  }

  const roots: string[] = [];
  const expandedAgentDir = agentDir ? expandPath(agentDir) : '';
  if (expandedAgentDir) {
    roots.push(join(expandedAgentDir, 'skill'));
    roots.push(join(expandedAgentDir, 'skills'));
  }

  const resourcesDir = getResourcesDir();
  roots.push(join(resourcesDir, 'agent', 'skill'));
  roots.push(join(resourcesDir, 'agent', 'skills'));
  roots.push(join(process.cwd(), 'agent', 'skill'));
  roots.push(join(process.cwd(), 'agent', 'skills'));

  if (process.resourcesPath) {
    roots.push(join(process.resourcesPath, 'agent', 'skill'));
    roots.push(join(process.resourcesPath, 'agent', 'skills'));
  }

  return dedupePaths(roots);
}

function buildDescriptors(params: QuickAccessScanParams): SourceDescriptor[] {
  const workspace = params.workspace ? expandPath(params.workspace) : '';
  const openClawDir = params.openClawDir ? expandPath(params.openClawDir) : getOpenClawDir();

  return [
    {
      source: 'workspace',
      sourceLabel: 'Workspace',
      priority: 0,
      roots: dedupePaths([
        join(workspace, 'skill'),
        join(workspace, 'skills'),
      ].filter(Boolean)),
    },
    {
      source: 'openclaw',
      sourceLabel: 'OpenClaw',
      priority: 1,
      roots: dedupePaths([join(openClawDir, 'skills')]),
    },
    {
      source: 'system',
      sourceLabel: 'System',
      priority: 2,
      roots: resolveSystemRoots(params.agentDir, params.systemRoots),
    },
  ];
}

export async function collectQuickAccessSkills(params: QuickAccessScanParams): Promise<QuickAccessSkill[]> {
  const descriptors = buildDescriptors(params);
  const discovered = await Promise.all(
    descriptors.flatMap((descriptor) =>
      descriptor.roots.map((root) => scanRoot({ ...descriptor, root })),
    ),
  );

  const byName = new Map<string, QuickAccessSkill & { priority: number }>();
  for (const descriptor of descriptors) {
    const items = discovered
      .flat()
      .filter((item) => item.source === descriptor.source);
    for (const item of items) {
      const key = item.name.trim().toLowerCase();
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing || descriptor.priority < existing.priority) {
        byName.set(key, { ...item, priority: descriptor.priority });
      }
    }
  }

  return [...byName.values()]
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.name.localeCompare(right.name);
    })
    .map(({ priority: _priority, ...skill }) => skill);
}
