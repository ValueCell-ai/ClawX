import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import type { GatewayManager } from './manager';
import { withConfigLock } from '../utils/config-mutex';
import { resolveOpenClawConfigPath } from '../utils/paths';

export type OpenClawConfig = Record<string, unknown>;
/** Mutators may be replayed after a compare-and-swap conflict and must not perform external writes. */
export type OpenClawConfigMutator = (
  config: OpenClawConfig,
) => void | Promise<void>;

type ConfigDeliveryGatewayManager = Pick<GatewayManager, 'getStatus' | 'rpc'>;

interface ConfigSnapshot {
  config?: unknown;
  raw?: unknown;
  hash?: unknown;
}

interface ActiveMutationContext {
  config: OpenClawConfig;
  active: boolean;
  sourceExists: boolean;
}

export interface OpenClawConfigSnapshot {
  config: OpenClawConfig;
  exists: boolean;
}

interface FileConfigSnapshot {
  config: OpenClawConfig;
  raw: string | undefined;
}

let gatewayManager: ConfigDeliveryGatewayManager | undefined;
let transactionTail: Promise<void> = Promise.resolve();
const activeMutation = new AsyncLocalStorage<ActiveMutationContext>();

function parseConfig(raw: string): OpenClawConfig {
  const parsed = JSON5.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenClaw config must be an object');
  }
  return parsed as OpenClawConfig;
}

function serializeConfig(config: OpenClawConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function parseRunningConfigSnapshot(snapshot: ConfigSnapshot | undefined): OpenClawConfig {
  if (snapshot?.config && typeof snapshot.config === 'object' && !Array.isArray(snapshot.config)) {
    return structuredClone(snapshot.config) as OpenClawConfig;
  }
  const raw = typeof snapshot?.raw === 'string' ? snapshot.raw : '';
  if (!raw.trim()) {
    throw new Error('Gateway config.get returned an incomplete config snapshot');
  }
  return parseConfig(raw);
}

function isBaseHashConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /config changed since last load; re-run config\.get and retry/i.test(message);
}

async function mutateRunningConfig(
  manager: ConfigDeliveryGatewayManager,
  mutator: OpenClawConfigMutator,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await manager.rpc<ConfigSnapshot>('config.get', {});
    const hash = typeof snapshot?.hash === 'string' ? snapshot.hash.trim() : '';
    if (!hash) {
      throw new Error('Gateway config.get returned an incomplete config snapshot');
    }

    const config = parseRunningConfigSnapshot(snapshot);
    if (!await applyMutator(config, mutator, true)) return false;

    try {
      await manager.rpc('config.set', {
        raw: serializeConfig(config),
        baseHash: hash,
      });
      return true;
    } catch (error) {
      if (attempt === 0 && isBaseHashConflict(error)) continue;
      throw error;
    }
  }

  return false;
}

async function applyMutator(
  config: OpenClawConfig,
  mutator: OpenClawConfigMutator,
  sourceExists: boolean,
): Promise<boolean> {
  const baseline = structuredClone(config);
  const context: ActiveMutationContext = { config, active: true, sourceExists };
  try {
    await activeMutation.run(context, async () => await mutator(config));
  } finally {
    context.active = false;
  }
  return !isDeepStrictEqual(config, baseline);
}

async function applyNestedMutator(
  context: ActiveMutationContext,
  mutator: OpenClawConfigMutator,
): Promise<boolean> {
  const baseline = structuredClone(context.config);
  await mutator(context.config);
  return !isDeepStrictEqual(context.config, baseline);
}

async function readFileConfig(configPath: string): Promise<FileConfigSnapshot> {
  try {
    const raw = await readFile(configPath, 'utf8');
    return { config: parseConfig(raw), raw };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: {}, raw: undefined };
    }
    throw error;
  }
}

async function readFileRaw(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function removeTemporaryFile(temporaryPath: string): Promise<void> {
  try {
    await unlink(temporaryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function mutateFileConfig(
  manager: ConfigDeliveryGatewayManager | undefined,
  mutator: OpenClawConfigMutator,
): Promise<boolean> {
  return await withConfigLock(async () => {
    const configPath = resolveOpenClawConfigPath();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await readFileConfig(configPath);
      const changed = await applyMutator(snapshot.config, mutator, snapshot.raw !== undefined);

      if (manager?.getStatus().state === 'running') {
        return await mutateRunningConfig(manager, mutator);
      }
      if (!changed) return false;

      await mkdir(dirname(configPath), { recursive: true });
      const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, serializeConfig(snapshot.config), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });

      try {
        if (manager?.getStatus().state === 'running') {
          return await mutateRunningConfig(manager, mutator);
        }

        const currentRaw = await readFileRaw(configPath);
        if (manager?.getStatus().state === 'running') {
          return await mutateRunningConfig(manager, mutator);
        }
        if (currentRaw !== snapshot.raw) {
          if (attempt === 0) continue;
          throw new Error('OpenClaw config changed during file mutation; retry the mutation');
        }

        await rename(temporaryPath, configPath);
        return true;
      } finally {
        await removeTemporaryFile(temporaryPath);
      }
    }

    return false;
  });
}

async function runMutation(mutator: OpenClawConfigMutator): Promise<boolean> {
  const manager = gatewayManager;
  if (manager?.getStatus().state === 'running') {
    return await mutateRunningConfig(manager, mutator);
  }
  return await mutateFileConfig(manager, mutator);
}

async function runRead(): Promise<OpenClawConfigSnapshot> {
  const manager = gatewayManager;
  if (manager?.getStatus().state === 'running') {
    const snapshot = await manager.rpc<ConfigSnapshot>('config.get', {});
    return { config: parseRunningConfigSnapshot(snapshot), exists: true };
  }

  const snapshot = await readFileConfig(resolveOpenClawConfigPath());
  return { config: snapshot.config, exists: snapshot.raw !== undefined };
}

async function runSecretsReload(): Promise<boolean> {
  const manager = gatewayManager;
  if (manager?.getStatus().state !== 'running') return false;
  await manager.rpc('secrets.reload', {});
  return true;
}

export function registerOpenClawConfigCoordinator(
  manager: ConfigDeliveryGatewayManager,
): void {
  gatewayManager = manager;
}

export function mutateOpenClawConfig(
  mutator: OpenClawConfigMutator,
): Promise<boolean> {
  const context = activeMutation.getStore();
  if (context?.active) {
    return applyNestedMutator(context, mutator);
  }

  const transaction = transactionTail.then(
    () => runMutation(mutator),
    () => runMutation(mutator),
  );
  transactionTail = transaction.then(
    () => undefined,
    () => undefined,
  );
  return transaction;
}

export function readOpenClawConfigSnapshot(): Promise<OpenClawConfigSnapshot> {
  const context = activeMutation.getStore();
  if (context?.active) {
    return Promise.resolve({
      config: structuredClone(context.config),
      exists: context.sourceExists,
    });
  }

  const transaction = transactionTail.then(
    () => runRead(),
    () => runRead(),
  );
  transactionTail = transaction.then(
    () => undefined,
    () => undefined,
  );
  return transaction;
}

export function reloadOpenClawSecretsIfRunning(): Promise<boolean> {
  const transaction = transactionTail.then(
    () => runSecretsReload(),
    () => runSecretsReload(),
  );
  transactionTail = transaction.then(
    () => undefined,
    () => undefined,
  );
  return transaction;
}

export function resetOpenClawConfigCoordinatorForTests(): void {
  gatewayManager = undefined;
  transactionTail = Promise.resolve();
}
