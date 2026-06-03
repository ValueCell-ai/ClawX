import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import YAML from 'yaml';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { expandPath, getOpenClawResolvedDir, getOpenClawSkillsDir } from '../../utils/paths';
import { getAllSkillConfigs } from '../../utils/skill-config';
import type { SkillConfigUpdates } from '../../utils/skill-config';

export interface LocalSkillMarketplaceMeta {
  provider: string;
  slug?: string;
  installedVersion?: string;
  manifestPath?: string;
  originPath?: string;
}

export interface LocalSkillRecord {
  id: string;
  slug?: string;
  name: string;
  description: string;
  enabled: boolean;
  icon?: string;
  version?: string;
  author?: string;
  config?: Record<string, unknown>;
  isCore?: boolean;
  isBundled?: boolean;
  source?: string;
  baseDir?: string;
  filePath?: string;
  marketplace?: LocalSkillMarketplaceMeta;
}

type SourceDescriptor = {
  root: string;
  source: string;
  priority: number;
  allowedSkillSlugs?: Set<string>;
};

type ParsedSkillManifest = {
  id: string;
  slug?: string;
  name: string;
  description: string;
  icon?: string;
  version?: string;
  author?: string;
  isCore?: boolean;
};

type ScannedSkillRecord = LocalSkillRecord & {
  priority: number;
};

type OriginMeta = {
  provider: string;
  slug?: string;
  installedVersion?: string;
  source?: string;
};

type ManifestMeta = {
  slug?: string;
  version?: string;
  author?: string;
};

type PreinstalledMeta = {
  slug?: string;
  version?: string;
};

const MAX_SKILL_FILE_BYTES = 256_000;
const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);

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

function normalizeKey(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const normalized = resolve(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const parsed = YAML.parse(match[1]);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

async function parseSkillManifest(manifestPath: string, fallbackId: string): Promise<ParsedSkillManifest> {
  const fileStat = await stat(manifestPath);
  if (fileStat.size > MAX_SKILL_FILE_BYTES) {
    return {
      id: fallbackId,
      name: fallbackId,
      description: 'Description unavailable (SKILL.md exceeds size limit).',
    };
  }

  const content = await readFile(manifestPath, 'utf-8');
  const frontmatter = parseFrontmatter(content);
  const metadata = frontmatter.metadata && typeof frontmatter.metadata === 'object'
    ? frontmatter.metadata as Record<string, unknown>
    : {};
  const openclawMeta = metadata.openclaw && typeof metadata.openclaw === 'object'
    ? metadata.openclaw as Record<string, unknown>
    : {};

  return {
    id: toStringValue(openclawMeta.skillKey) || fallbackId,
    slug: undefined,
    name: toStringValue(frontmatter.name) || fallbackId,
    description: toStringValue(frontmatter.description) || parseBodyDescription(content),
    icon: toStringValue(openclawMeta.emoji),
    version: toStringValue(frontmatter.version),
    author: toStringValue(frontmatter.author),
    isCore: toBooleanValue(openclawMeta.always) || false,
  };
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) return null;
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readOriginMeta(skillDir: string): Promise<OriginMeta | null> {
  const parsed = await safeReadJson<Record<string, unknown>>(join(skillDir, '.clawhub', 'origin.json'));
  if (!parsed) return null;
  return {
    provider: 'clawhub',
    slug: toStringValue(parsed.slug),
    installedVersion: toStringValue(parsed.installedVersion) || toStringValue(parsed.version),
    source: toStringValue(parsed.source),
  };
}

async function readManifestMeta(skillDir: string): Promise<ManifestMeta | null> {
  const parsed = await safeReadJson<Record<string, unknown>>(join(skillDir, 'manifest.json'));
  if (!parsed) return null;
  return {
    slug: toStringValue(parsed.slug) || toStringValue(parsed.name),
    version: toStringValue(parsed.version),
    author: toStringValue(parsed.author),
  };
}

async function readPreinstalledMeta(skillDir: string): Promise<PreinstalledMeta | null> {
  const parsed = await safeReadJson<Record<string, unknown>>(join(skillDir, '.clawx-preinstalled.json'));
  if (!parsed) return null;
  return {
    slug: toStringValue(parsed.slug),
    version: toStringValue(parsed.version),
  };
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

async function inspectSkillDir(
  descriptor: SourceDescriptor,
  rootRealPath: string,
  skillDir: string,
  configs: Record<string, SkillConfigUpdates>,
): Promise<ScannedSkillRecord | null> {
  const manifestPath = join(skillDir, 'SKILL.md');
  if (!(await pathExists(manifestPath))) return null;

  try {
    const skillDirRealPath = await realpath(skillDir);
    if (!isInsideRoot(rootRealPath, skillDirRealPath)) {
      return null;
    }

    const fallbackId = basename(skillDirRealPath);
    const parsedManifest = await parseSkillManifest(manifestPath, fallbackId);
    const [originMeta, manifestMeta, preinstalledMeta] = await Promise.all([
      readOriginMeta(skillDirRealPath),
      readManifestMeta(skillDirRealPath),
      readPreinstalledMeta(skillDirRealPath),
    ]);

    const skillKey = parsedManifest.id || manifestMeta?.slug || originMeta?.slug || fallbackId;
    const rawConfig = configs[skillKey] || {};
    const config: Record<string, unknown> = { ...rawConfig };
    const version = manifestMeta?.version || parsedManifest.version || originMeta?.installedVersion;
    const source = descriptor.source;
    const isBundled = source === 'openclaw-bundled' || Boolean(preinstalledMeta);
    const marketplace = originMeta || manifestMeta
      ? {
          provider: originMeta?.provider || (manifestMeta ? 'manifest' : source),
          slug: originMeta?.slug || manifestMeta?.slug || preinstalledMeta?.slug || fallbackId,
          installedVersion: version,
          manifestPath: manifestMeta ? join(skillDirRealPath, 'manifest.json') : undefined,
          originPath: originMeta ? join(skillDirRealPath, '.clawhub', 'origin.json') : undefined,
        }
      : undefined;

    return {
      id: skillKey,
      slug: originMeta?.slug || manifestMeta?.slug || preinstalledMeta?.slug || fallbackId,
      name: parsedManifest.name,
      description: parsedManifest.description,
      enabled: rawConfig.enabled !== false,
      icon: parsedManifest.icon || (isBundled ? '🧩' : '📦'),
      version,
      author: manifestMeta?.author || parsedManifest.author,
      config,
      isCore: parsedManifest.isCore,
      isBundled,
      source,
      baseDir: skillDirRealPath,
      filePath: manifestPath,
      marketplace,
      priority: descriptor.priority,
    };
  } catch {
    return null;
  }
}

async function scanRoot(
  descriptor: SourceDescriptor,
  configs: Record<string, SkillConfigUpdates>,
): Promise<ScannedSkillRecord[]> {
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
        if (!descriptor.allowedSkillSlugs || descriptor.allowedSkillSlugs.has(entry.name)) {
          skillDirs.add(entryPath);
        }
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
          // Ignore broken symlinks.
        }
      }
    }
  } catch {
    return [];
  }

  const items = await Promise.all([...skillDirs].map((skillDir) => inspectSkillDir(descriptor, rootRealPath, skillDir, configs)));
  return items.filter((item): item is ScannedSkillRecord => item != null);
}

async function buildDescriptors(): Promise<SourceDescriptor[]> {
  const agentsSnapshot = await listAgentsSnapshot();
  const workspaces = dedupePaths(
    agentsSnapshot.agents
      .map((agent) => expandPath(agent.workspace || ''))
      .filter(Boolean),
  );

  return [
    ...workspaces.map((workspace) => ({
      root: join(workspace, 'skills'),
      source: 'openclaw-workspace',
      priority: 0,
    })),
    ...workspaces.map((workspace) => ({
      root: join(workspace, '.agents', 'skills'),
      source: 'agents-skills-project',
      priority: 1,
    })),
    {
      root: join(homedir(), '.agents', 'skills'),
      source: 'agents-skills-personal',
      priority: 2,
    },
    {
      root: getOpenClawSkillsDir(),
      source: 'openclaw-managed',
      priority: 3,
    },
    {
      root: join(getOpenClawResolvedDir(), 'skills'),
      source: 'openclaw-bundled',
      priority: 4,
      allowedSkillSlugs: BUNDLED_OPENCLAW_SKILL_ALLOWLIST,
    },
  ];
}

function mergeScannedSkills(skills: ScannedSkillRecord[]): LocalSkillRecord[] {
  const byKey = new Map<string, ScannedSkillRecord>();

  for (const skill of skills) {
    const key = normalizeKey(skill.id || skill.slug || skill.name || skill.baseDir);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || skill.priority < existing.priority) {
      byKey.set(key, skill);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      if (left.isCore !== right.isCore) {
        return left.isCore ? -1 : 1;
      }
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.name.localeCompare(right.name);
    })
    .map(({ priority: _priority, ...skill }) => skill);
}

export async function listLocalSkills(): Promise<LocalSkillRecord[]> {
  const [descriptors, configs] = await Promise.all([
    buildDescriptors(),
    getAllSkillConfigs(),
  ]);

  const discovered = await Promise.all(descriptors.map((descriptor) => scanRoot(descriptor, configs)));
  return mergeScannedSkills(discovered.flat());
}
