import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, delimiter, join, relative, resolve } from 'node:path';

type EnvTarget = NodeJS.ProcessEnv;

export type LoadedLocalRealEnvFile = {
  name: string;
  loaded: boolean;
  variableNames: string[];
  safety?: {
    location: 'repo' | 'outside-repo';
    gitignored: boolean;
    tracked: boolean;
    safe: boolean;
  };
  skippedReason?: string;
};

function execGit(root: string, args: string[]): boolean {
  try {
    execFileSync('git', args, {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isPathInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !relativePath.startsWith('/');
}

function localEnvFileSafety(root: string, path: string): LoadedLocalRealEnvFile['safety'] {
  if (!execGit(root, ['rev-parse', '--is-inside-work-tree']) || !isPathInsideRoot(root, path)) {
    return { location: 'outside-repo', gitignored: true, tracked: false, safe: true };
  }
  const relativePath = relative(root, path);
  const tracked = execGit(root, ['ls-files', '--error-unmatch', '--', relativePath]);
  const gitignored = execGit(root, ['check-ignore', '--quiet', '--', relativePath]);
  return {
    location: 'repo',
    gitignored,
    tracked,
    safe: gitignored && !tracked,
  };
}

function displayEnvFileName(file: string): string {
  return basename(file) || file;
}

export function extraLocalRealEnvFiles(env: EnvTarget): string[] {
  const single = env.CLAWX_REAL_ENV_FILE?.trim();
  const multiple = env.CLAWX_REAL_ENV_FILES
    ?.split(delimiter)
    .map((file) => file.trim())
    .filter(Boolean) ?? [];
  return [...new Set([
    ...(single ? [single] : []),
    ...multiple,
  ])];
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseLocalRealEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = stripOptionalQuotes(normalized.slice(separator + 1));
  }
  return parsed;
}

export function loadLocalRealEnvFiles(options: {
  root?: string;
  env?: EnvTarget;
  files?: string[];
} = {}): LoadedLocalRealEnvFile[] {
  const root = resolve(options.root ?? process.cwd());
  const env = options.env ?? process.env;
  const files = options.files ?? [
    '.env.cc-connect.local',
    '.env.local',
    '.env',
  ];
  const summaries: LoadedLocalRealEnvFile[] = [];

  for (const file of files) {
    const path = resolve(root, file);
    const safety = localEnvFileSafety(root, path);
    if (!existsSync(path)) {
      summaries.push({ name: displayEnvFileName(file), loaded: false, variableNames: [], safety });
      continue;
    }
    if (safety?.location === 'repo' && !safety.safe) {
      summaries.push({
        name: displayEnvFileName(file),
        loaded: false,
        variableNames: [],
        safety,
        skippedReason: 'repo-local env files must be untracked and gitignored before they can be loaded',
      });
      continue;
    }
    const parsed = parseLocalRealEnvFile(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
    summaries.push({
      name: displayEnvFileName(file),
      loaded: true,
      variableNames: Object.keys(parsed).sort(),
      safety,
    });
  }

  return summaries;
}

export function loadDefaultCcConnectLocalRealEnv(): LoadedLocalRealEnvFile[] {
  return loadLocalRealEnvFiles({
    root: join(__dirname, '..', '..', '..'),
    files: [
      '.env.cc-connect.local',
      '.env.local',
      '.env',
      ...extraLocalRealEnvFiles(process.env),
    ],
  });
}
