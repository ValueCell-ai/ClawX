import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCcConnectManagedDir } from './cc-connect-paths';

function safeName(value: string): string {
  return encodeURIComponent(value.trim() || 'default').replace(/%/g, '_');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function ensureCcConnectCodexLauncher(options: {
  accountId: string;
  codexHomeDir: string;
  codexPath: string;
  envAliases?: Record<string, string>;
}): Promise<string> {
  const launchersDir = join(getCcConnectManagedDir(), 'config', 'launchers');
  await mkdir(launchersDir, { recursive: true });
  const baseName = `codex-${safeName(options.accountId)}`;

  if (process.platform === 'win32') {
    const path = join(launchersDir, `${baseName}.cmd`);
    const content = [
      '@echo off',
      `set "CODEX_HOME=${options.codexHomeDir}"`,
      ...Object.entries(options.envAliases ?? {}).map(([target, source]) => `set "${target}=%${source}%"`),
      `"${options.codexPath.replace(/"/g, '""')}" %*`,
      '',
    ].join('\r\n');
    await writeFile(path, content, { encoding: 'utf8', mode: 0o700 });
    return path;
  }

  const path = join(launchersDir, baseName);
  const content = [
    '#!/bin/sh',
    `export CODEX_HOME=${shellQuote(options.codexHomeDir)}`,
    ...Object.entries(options.envAliases ?? {}).map(([target, source]) => `export ${target}="\${${source}}"`),
    `exec ${shellQuote(options.codexPath)} "$@"`,
    '',
  ].join('\n');
  await writeFile(path, content, { encoding: 'utf8', mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}
