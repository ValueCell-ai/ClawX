import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import type { GatewayManager } from './manager';
import { withConfigLock } from '../utils/config-mutex';
import { logger } from '../utils/logger';
import { resolveOpenClawConfigPath } from '../utils/paths';

export type OpenClawConfig = Record<string, unknown>;
/** Mutators may be replayed after a compare-and-swap conflict and must not perform external writes. */
export type OpenClawConfigMutator = (
  config: OpenClawConfig,
) => void | Promise<void>;
/** Runs inside the serialized transaction before each pure mutator application. */
export type OpenClawConfigBeforeApply = () => void | Promise<void>;
export type OpenClawConfigMutationOptions = {
  beforeApply?: OpenClawConfigBeforeApply;
};

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

/** Placeholder OpenClaw substitutes for sensitive values in `config.get` snapshots. */
const OPENCLAW_REDACTED_SENTINEL = '__OPENCLAW_REDACTED__';
/** `meta` fields OpenClaw stamps automatically on every config write. */
const OPENCLAW_AUTO_MANAGED_META_FIELDS = ['lastTouchedAt', 'lastTouchedVersion'] as const;

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

/**
 * The Gateway socket went away underneath an RPC: stopped, never connected, or
 * an OpenClaw code-1012 in-process restart (typically triggered by an earlier
 * config commit). The request outcome is unknown, but nothing else writes the
 * config file while the Gateway is down.
 */
function isGatewayUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Gateway stopped')
    || message.includes('Gateway not connected')
    || message.includes('Gateway service restart')
    || message.includes('Failed to send RPC request:');
}

function isConfigSetResponseLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('RPC timeout: config.set') || isGatewayUnavailableError(error);
}

function stripAutoManagedMeta(config: OpenClawConfig): OpenClawConfig {
  const clone = structuredClone(config);
  const meta = clone.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const nextMeta: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
    for (const field of OPENCLAW_AUTO_MANAGED_META_FIELDS) delete nextMeta[field];
    if (Object.keys(nextMeta).length === 0) {
      delete clone.meta;
    } else {
      clone.meta = nextMeta;
    }
  }
  return clone;
}

/**
 * Compare what ClawX submitted through `config.set` with what OpenClaw persisted.
 * `config.get` redacts sensitive values to a sentinel that `config.set` restores
 * from its base snapshot, so a sentinel on the submitted side matches any real
 * persisted value.
 */
function isPersistedValueEquivalent(persisted: unknown, submitted: unknown): boolean {
  if (submitted === OPENCLAW_REDACTED_SENTINEL) {
    return persisted !== undefined && persisted !== null;
  }
  if (Array.isArray(submitted)) {
    return Array.isArray(persisted)
      && persisted.length === submitted.length
      && submitted.every((item, index) => isPersistedValueEquivalent(persisted[index], item));
  }
  if (submitted && typeof submitted === 'object') {
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return false;
    const submittedRecord = submitted as Record<string, unknown>;
    const persistedRecord = persisted as Record<string, unknown>;
    const keys = new Set([...Object.keys(submittedRecord), ...Object.keys(persistedRecord)]);
    for (const key of keys) {
      if (!isPersistedValueEquivalent(persistedRecord[key], submittedRecord[key])) return false;
    }
    return true;
  }
  return isDeepStrictEqual(persisted, submitted);
}

export function isPersistedConfigSetCommitEquivalent(
  persisted: OpenClawConfig,
  submitted: OpenClawConfig,
): boolean {
  return isPersistedValueEquivalent(stripAutoManagedMeta(persisted), stripAutoManagedMeta(submitted));
}

async function acceptPersistedConfigSetCommitIfMatched(config: OpenClawConfig): Promise<boolean> {
  const persisted = await readFileConfig(resolveOpenClawConfigPath());
  return isPersistedConfigSetCommitEquivalent(persisted.config, config);
}

async function mutateRunningConfig(
  manager: ConfigDeliveryGatewayManager,
  mutator: OpenClawConfigMutator,
  options: OpenClawConfigMutationOptions,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await manager.rpc<ConfigSnapshot>('config.get', {});
    const hash = typeof snapshot?.hash === 'string' ? snapshot.hash.trim() : '';
    if (!hash) {
      throw new Error('Gateway config.get returned an incomplete config snapshot');
    }

    const config = parseRunningConfigSnapshot(snapshot);
    await options.beforeApply?.();
    if (!await applyMutator(config, mutator, true)) return false;

    try {
      await manager.rpc('config.set', {
        raw: serializeConfig(config),
        baseHash: hash,
      });
      return true;
    } catch (error) {
      if (attempt === 0 && isBaseHashConflict(error)) continue;

      // config.set may durably replace the file and then close the socket with
      // code 1012 before its RPC response reaches ClawX. Reconnect can restore
      // running state before the RPC timeout fires, so verify the persisted
      // snapshot whenever the response was lost instead of only while stopped.
      if (manager.getStatus().state !== 'running' || isConfigSetResponseLost(error)) {
        if (await acceptPersistedConfigSetCommitIfMatched(config)) return true;
      }
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
  options: OpenClawConfigMutationOptions,
): Promise<boolean> {
  return await withConfigLock(async () => {
    const configPath = resolveOpenClawConfigPath();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await readFileConfig(configPath);
      await options.beforeApply?.();
      const changed = await applyMutator(snapshot.config, mutator, snapshot.raw !== undefined);

      if (manager?.getStatus().state === 'running') {
        return await mutateRunningConfig(manager, mutator, options);
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
          return await mutateRunningConfig(manager, mutator, options);
        }

        const currentRaw = await readFileRaw(configPath);
        if (manager?.getStatus().state === 'running') {
          return await mutateRunningConfig(manager, mutator, options);
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

async function runMutation(
  mutator: OpenClawConfigMutator,
  options: OpenClawConfigMutationOptions,
): Promise<boolean> {
  const manager = gatewayManager;
  if (manager?.getStatus().state === 'running') {
    try {
      return await mutateRunningConfig(manager, mutator, options);
    } catch (error) {
      if (!isGatewayUnavailableError(error)) throw error;
      // The socket dropped mid-transaction (usually a code-1012 reload caused by
      // this or a previous commit). Mutators are pure and replayable, so apply
      // it again against the durable file: an already-landed commit becomes a
      // no-op, a lost one is written by ClawX, and the file path switches back
      // to RPC by itself once the Gateway is running again.
      logger.info(
        `[config-delivery] Gateway unavailable during running mutation; replaying through file path (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return await mutateFileConfig(manager, mutator, options);
}

async function runRead(): Promise<OpenClawConfigSnapshot> {
  const manager = gatewayManager;
  if (manager?.getStatus().state === 'running') {
    try {
      const snapshot = await manager.rpc<ConfigSnapshot>('config.get', {});
      return { config: parseRunningConfigSnapshot(snapshot), exists: true };
    } catch (error) {
      if (!isGatewayUnavailableError(error)) throw error;
      // Fall through to the durable file; the Gateway restarts from that same file.
    }
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
  options: OpenClawConfigMutationOptions = {},
): Promise<boolean> {
  const context = activeMutation.getStore();
  if (context?.active) {
    return applyNestedMutator(context, mutator);
  }

  const transaction = transactionTail.then(
    () => runMutation(mutator, options),
    () => runMutation(mutator, options),
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
