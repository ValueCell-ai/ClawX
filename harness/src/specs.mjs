import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPEC_ROOT = path.join(ROOT, 'harness', 'specs');

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error('Spec must start with Markdown frontmatter');
  }

  const data = {};
  let currentKey = null;
  let nestedKey = null;

  for (const rawLine of match[1].split('\n')) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const line = rawLine.trim();

    if (indent === 0) {
      const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
      if (!keyMatch) continue;
      const [, key, rawValue] = keyMatch;
      currentKey = key;
      nestedKey = null;
      data[key] = rawValue.trim() ? parseScalar(rawValue) : [];
      continue;
    }

    if (indent === 2 && line.startsWith('- ')) {
      if (!currentKey) continue;
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(line.slice(2)));
      continue;
    }

    if (indent === 2) {
      const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
      if (!keyMatch || !currentKey) continue;
      const [, key, rawValue] = keyMatch;
      if (!data[currentKey] || Array.isArray(data[currentKey])) data[currentKey] = {};
      nestedKey = key;
      data[currentKey][key] = rawValue.trim() ? parseScalar(rawValue) : [];
      continue;
    }

    if (indent === 4 && line.startsWith('- ') && currentKey && nestedKey) {
      if (!data[currentKey] || Array.isArray(data[currentKey])) data[currentKey] = {};
      if (!Array.isArray(data[currentKey][nestedKey])) data[currentKey][nestedKey] = [];
      data[currentKey][nestedKey].push(parseScalar(line.slice(2)));
    }
  }

  return {
    data,
    body: markdown.slice(match[0].length).trim(),
  };
}

export async function loadSpec(specPath) {
  const fullPath = path.resolve(ROOT, specPath);
  const markdown = await readFile(fullPath, 'utf8');
  return {
    path: path.relative(ROOT, fullPath),
    ...parseFrontmatter(markdown),
  };
}

async function listMarkdownFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

export async function loadScenarioSpecs() {
  const files = await listMarkdownFiles(path.join(SPEC_ROOT, 'scenarios'));
  const specs = [];
  for (const file of files) {
    const spec = await loadSpec(path.relative(ROOT, file));
    specs.push(spec);
  }
  return specs;
}

export async function loadRuleSpecs() {
  const files = await listMarkdownFiles(path.join(SPEC_ROOT, 'rules'));
  const specs = [];
  for (const file of files) {
    const spec = await loadSpec(path.relative(ROOT, file));
    specs.push(spec);
  }
  return specs;
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function isGatewayBackendCommunicationTask(spec) {
  return spec.data?.scenario === 'gateway-backend-communication'
    || toArray(spec.data?.scenarios).includes('gateway-backend-communication');
}

export function isPluginLifecycleTask(spec) {
  return spec.data?.scenario === 'plugin-lifecycle-management'
    || toArray(spec.data?.scenarios).includes('plugin-lifecycle-management');
}

export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function pathMatchesAny(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}
