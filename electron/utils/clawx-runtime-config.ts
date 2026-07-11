import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { getClawXDataLayout, resolveClawXDataRoot } from './clawx-data-layout';

type RuntimeConfigDocument<T> = {
  schema: 'clawx-runtime-config';
  version: 1;
  importedFromOpenClawAt?: string;
  updatedAt: string;
  config: T;
};

function runtimeConfigPath(): string {
  const layout = getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData')));
  return join(layout.appDir, 'runtime-config.json');
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => {});
  await rename(temporaryPath, path);
  await chmod(path, 0o600).catch(() => {});
}

async function readDocument<T>(): Promise<RuntimeConfigDocument<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(runtimeConfigPath(), 'utf8')) as Partial<RuntimeConfigDocument<T>>;
    if (parsed.schema === 'clawx-runtime-config' && parsed.version === 1 && parsed.config) {
      return parsed as RuntimeConfigDocument<T>;
    }
  } catch {
    // Missing canonical config is imported from the compatibility source.
  }
  return null;
}

export async function readClawXRuntimeConfig<T extends Record<string, unknown>>(options: {
  readOpenClawCompatibility: () => Promise<T>;
  openClawConfigPath: string;
}): Promise<T> {
  const canonicalPath = runtimeConfigPath();
  const document = await readDocument<T>();
  if (document) return document.config;

  const config = await options.readOpenClawCompatibility();
  await writeAtomic(canonicalPath, {
    schema: 'clawx-runtime-config',
    version: 1,
    importedFromOpenClawAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config,
  } satisfies RuntimeConfigDocument<T>);
  return config;
}

export async function writeClawXRuntimeConfig<T extends Record<string, unknown>>(config: T): Promise<void> {
  await writeAtomic(runtimeConfigPath(), {
    schema: 'clawx-runtime-config',
    version: 1,
    updatedAt: new Date().toISOString(),
    config,
  } satisfies RuntimeConfigDocument<T>);
}

export function getClawXRuntimeConfigPath(): string {
  return runtimeConfigPath();
}
