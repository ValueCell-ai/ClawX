/**
 * Skill directory introspection.
 *
 * Recursively scans a skill's `baseDir`, filtering noisy directories
 * (node_modules, __pycache__, .venv, …) and assigns each surviving file
 * to one of four buckets so the Skills detail page can render
 * "Docs / Scripts / Hooks / Assets" sections.
 */
import { listDir } from './api-client';
import {
  basenameOf,
  classifyFileExt,
  extnameOf,
  getMimeTypeForExt,
  type FileContentType,
} from './generated-files';

export type SkillFileCategory = 'doc' | 'script' | 'hook' | 'asset' | 'other';

export interface SkillFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  category: SkillFileCategory;
  size: number;
}

export interface SkillFileGroups {
  docs: SkillFile[];
  scripts: SkillFile[];
  hooks: SkillFile[];
  assets: SkillFile[];
  others: SkillFile[];
}

export const EMPTY_SKILL_GROUPS: SkillFileGroups = {
  docs: [],
  scripts: [],
  hooks: [],
  assets: [],
  others: [],
};

const SCAN_BLACKLIST = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

const SCRIPT_EXTS = new Set([
  '.py', '.js', '.ts', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.ps1',
  '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.tsx', '.jsx', '.lua', '.r',
]);

const ASSET_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a',
  '.mp4', '.webm', '.mov',
  '.ttf', '.otf', '.woff', '.woff2',
  '.pdf', '.zip', '.tar', '.gz',
]);

const DOC_NAME_HINTS = ['readme', 'changelog', 'license', 'contributing', 'authors'];

const ASSET_PATH_HINTS = ['/assets/', '/references/', '/templates/', '/static/', '/public/'];

const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_FILES = 400;

function categorizeSkillFile(relativePath: string, fileName: string, ext: string): SkillFileCategory {
  const lowerExt = ext.toLowerCase();
  const lowerName = fileName.toLowerCase();
  const lowerRel = relativePath.replace(/\\/g, '/').toLowerCase();
  const lowerRelWithSlash = `/${lowerRel}`;

  if (lowerRel.startsWith('hooks/') || lowerRelWithSlash.includes('/hooks/')) {
    return 'hook';
  }

  if (lowerRel.startsWith('scripts/') || lowerRelWithSlash.includes('/scripts/')) {
    return 'script';
  }

  if (ASSET_PATH_HINTS.some((hint) => lowerRelWithSlash.includes(hint))) {
    return 'asset';
  }

  if (lowerExt === '.md' || lowerExt === '.markdown' || lowerExt === '.rst' || lowerExt === '.txt') {
    return 'doc';
  }

  if (DOC_NAME_HINTS.some((hint) => lowerName.startsWith(hint))) {
    return 'doc';
  }

  if (SCRIPT_EXTS.has(lowerExt)) {
    return 'script';
  }

  if (ASSET_EXTS.has(lowerExt)) {
    return 'asset';
  }

  return 'other';
}

function buildSkillFile(absPath: string, relPath: string, size: number): SkillFile {
  const fileName = basenameOf(absPath);
  const ext = extnameOf(absPath);
  return {
    filePath: absPath,
    relativePath: relPath,
    fileName,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
    category: categorizeSkillFile(relPath, fileName, ext),
    size,
  };
}

function relPathFromBase(absPath: string, baseDir: string): string {
  const baseNorm = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const norm = absPath.replace(/\\/g, '/');
  if (norm === baseNorm) return '';
  if (norm.startsWith(baseNorm + '/')) {
    return norm.slice(baseNorm.length + 1);
  }
  return norm;
}

/**
 * Scan `baseDir` (skill root) and return files grouped by category.
 * Stops descending into noise directories and caps total file count.
 */
export async function loadSkillFiles(baseDir: string): Promise<SkillFileGroups> {
  if (!baseDir) return EMPTY_SKILL_GROUPS;

  const groups: SkillFileGroups = {
    docs: [],
    scripts: [],
    hooks: [],
    assets: [],
    others: [],
  };

  const files: SkillFile[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) return;
    if (files.length >= MAX_SCAN_FILES) return;
    const result = await listDir(dir);
    if (!result.ok || !result.entries) return;

    for (const entry of result.entries) {
      if (files.length >= MAX_SCAN_FILES) break;
      if (entry.isDir) {
        if (SCAN_BLACKLIST.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(entry.path, depth + 1);
      } else {
        if (entry.name.startsWith('.')) continue;
        const rel = relPathFromBase(entry.path, baseDir);
        files.push(buildSkillFile(entry.path, rel, entry.size));
      }
    }
  };

  try {
    await walk(baseDir, 1);
  } catch {
    return groups;
  }

  for (const file of files) {
    switch (file.category) {
      case 'doc':
        groups.docs.push(file);
        break;
      case 'script':
        groups.scripts.push(file);
        break;
      case 'hook':
        groups.hooks.push(file);
        break;
      case 'asset':
        groups.assets.push(file);
        break;
      default:
        groups.others.push(file);
    }
  }

  // Stable order: SKILL.md first in docs, then alphabetical; others alphabetical.
  const skillMdSort = (a: SkillFile, b: SkillFile): number => {
    const aIsSkill = a.fileName.toLowerCase() === 'skill.md';
    const bIsSkill = b.fileName.toLowerCase() === 'skill.md';
    if (aIsSkill !== bIsSkill) return aIsSkill ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  };
  const alphaSort = (a: SkillFile, b: SkillFile): number =>
    a.relativePath.localeCompare(b.relativePath);

  groups.docs.sort(skillMdSort);
  groups.scripts.sort(alphaSort);
  groups.hooks.sort(alphaSort);
  groups.assets.sort(alphaSort);
  groups.others.sort(alphaSort);

  return groups;
}

export function isSkillFileGroupsEmpty(groups: SkillFileGroups): boolean {
  return groups.docs.length === 0 &&
    groups.scripts.length === 0 &&
    groups.hooks.length === 0 &&
    groups.assets.length === 0 &&
    groups.others.length === 0;
}
