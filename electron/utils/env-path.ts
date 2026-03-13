type EnvMap = Record<string, string | undefined>;

function isPathKey(key: string): boolean {
  return key.toLowerCase() === 'path';
}

function preferredPathKey(): string {
  return process.platform === 'win32' ? 'Path' : 'PATH';
}

function pathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

export function getPathEnvKey(env: EnvMap): string {
  const keys = Object.keys(env).filter(isPathKey);
  if (keys.length === 0) return preferredPathKey();

  if (process.platform === 'win32') {
    if (keys.includes('Path')) return 'Path';
    if (keys.includes('PATH')) return 'PATH';
    return keys[0];
  }

  if (keys.includes('PATH')) return 'PATH';
  return keys[0];
}

export function getPathEnvValue(env: EnvMap): string {
  const key = getPathEnvKey(env);
  return env[key] ?? '';
}

export function setPathEnvValue(
  env: EnvMap,
  nextPath: string,
): EnvMap {
  const nextEnv: EnvMap = { ...env };
  for (const key of Object.keys(nextEnv)) {
    if (isPathKey(key)) {
      delete nextEnv[key];
    }
  }

  nextEnv[getPathEnvKey(env)] = nextPath;
  return nextEnv;
}

export function prependPathEntry(
  env: EnvMap,
  entry: string,
): { env: EnvMap; path: string } {
  const current = getPathEnvValue(env);
  const nextPath = current ? `${entry}${pathDelimiter()}${current}` : entry;
  return {
    env: setPathEnvValue(env, nextPath),
    path: nextPath,
  };
}
