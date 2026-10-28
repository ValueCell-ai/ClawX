/**
 * Record OpenClaw capability consent for the plugin mirrors ClawX ships.
 *
 * OpenClaw 2026.10 asks for consent to the declared capability surface of any
 * installed plugin that is not a trusted official install. ClawX's path-owned
 * mirrors never qualify, so `openclaw plugins list` reports them as requiring
 * consent. The surface hash comes from OpenClaw's normalized manifest metadata
 * (which can add tools the raw manifest does not list), so ClawX lets the
 * OpenClaw CLI compute and persist it rather than writing the record itself.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { logger } from './logger';
import { getOpenClawResolvedDir } from './paths';
import { runOpenClawCommand } from './openclaw-command';
import { listClawXPathOwnedPluginMirrors } from './plugin-install';
import { readPluginInstallRecordsFromSqlite } from './plugin-install-index';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = 'plugin-capability-consent-cache.json';
// Each id costs a full OpenClaw metadata scan, config write, and registry
// refresh (about 9s on Apple Silicon).
const BASE_TIMEOUT_MS = 30_000;
const PER_PLUGIN_TIMEOUT_MS = 45_000;

type InstallRecord = Record<string, unknown>;

interface ConsentCacheEntry {
  fingerprint: string;
  attemptedAt: string;
  accepted: boolean;
}

interface ConsentCacheFile {
  schemaVersion: number;
  plugins: Record<string, ConsentCacheEntry>;
  /** OpenClaw version on which the managed Gateway last became ready. */
  gatewayReadyOpenClawVersion?: string;
}

export interface PluginCapabilityConsentSummary {
  status: 'up-to-date' | 'accepted' | 'failed' | 'deferred';
  attempted: string[];
  accepted: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDefaultCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE_NAME);
}

function readCache(cachePath: string): ConsentCacheFile {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as ConsentCacheFile;
    if (parsed.schemaVersion === CACHE_SCHEMA_VERSION && isPlainRecord(parsed.plugins)) {
      return parsed;
    }
  } catch {
    // Missing or unreadable cache: every candidate is attempted once.
  }
  return { schemaVersion: CACHE_SCHEMA_VERSION, plugins: {} };
}

function writeCache(cachePath: string, cache: ConsentCacheFile): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
  } catch (error) {
    logger.warn('[plugin] Failed to write capability consent cache:', error);
  }
}

function readOpenClawVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(getOpenClawResolvedDir(), 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function comparablePath(filePath: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(filePath);
  } catch {
    resolved = resolve(filePath);
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** `plugins enable` must never turn on a plugin the user or ClawX left off. */
export function isPluginExplicitlyEnabled(config: Record<string, unknown>, pluginId: string): boolean {
  const plugins = config.plugins;
  if (!isPlainRecord(plugins) || plugins.enabled === false) return false;
  if (Array.isArray(plugins.deny) && plugins.deny.includes(pluginId)) return false;
  if (Array.isArray(plugins.allow) && plugins.allow.length > 0 && !plugins.allow.includes(pluginId)) return false;
  const entry = isPlainRecord(plugins.entries) ? plugins.entries[pluginId] : undefined;
  return isPlainRecord(entry) && entry.enabled === true;
}

function hasAcceptedSurface(record: InstallRecord | undefined): boolean {
  return typeof record?.acceptedSurfaceHash === 'string' && record.acceptedSurfaceHash.length > 0;
}

function acceptanceChanged(before: InstallRecord | undefined, after: InstallRecord | undefined): boolean {
  return hasAcceptedSurface(after) && (
    !hasAcceptedSurface(before)
    || before?.acceptedSurfaceHash !== after?.acceptedSurfaceHash
    || before?.acceptedSurfaceAt !== after?.acceptedSurfaceAt
  );
}

function recordFingerprint(openclawVersion: string, record: InstallRecord): string {
  return JSON.stringify([openclawVersion, record.version, record.installPath, record.installedAt]);
}

function summarizeFailure(result: { stderr: string; stdout: string; error?: string }): string {
  const output = (result.stderr || result.stdout).trim().split('\n').slice(-5).join(' | ');
  return result.error ? `${result.error}${output ? `: ${output}` : ''}` : output;
}

async function enableWithConsent(pluginIds: string[]): Promise<{ success: boolean; timedOut: boolean }> {
  const result = await runOpenClawCommand(['plugins', 'enable', ...pluginIds, '--accept-capabilities'], {
    label: 'plugin capability consent',
    timeoutMs: BASE_TIMEOUT_MS + PER_PLUGIN_TIMEOUT_MS * pluginIds.length,
  });
  if (!result.success) {
    logger.warn(`[plugin] Capability consent failed for ${pluginIds.join(', ')}: ${summarizeFailure(result)}`);
  }
  return { success: result.success, timedOut: Boolean(result.timedOut) };
}

/**
 * Marks the current OpenClaw runtime as one whose config and state the Gateway
 * accepted. Until then, Doctor may still have migrations to run, and consent
 * commands would only scan plugins against unmigrated state.
 */
export function recordGatewayReadyForCapabilityConsent(options: { cachePath?: string } = {}): void {
  const cachePath = options.cachePath ?? getDefaultCachePath();
  const openclawVersion = readOpenClawVersion();
  const cache = readCache(cachePath);
  if (cache.gatewayReadyOpenClawVersion === openclawVersion) return;
  cache.gatewayReadyOpenClawVersion = openclawVersion;
  writeCache(cachePath, cache);
}

/**
 * Accept the declared capabilities of enabled ClawX path-owned mirrors whose
 * install record changed since the last attempt. Each record fingerprint is
 * attempted once, so a persistent failure does not slow every launch; it only
 * leaves OpenClaw's status-only consent warning in place. Until the Gateway
 * has become ready on the current OpenClaw version, the attempt is deferred
 * without recording it.
 */
export async function ensureClawXPluginCapabilityConsent(
  config: Record<string, unknown>,
  options: { cachePath?: string } = {},
): Promise<PluginCapabilityConsentSummary> {
  const cachePath = options.cachePath ?? getDefaultCachePath();
  const records = readPluginInstallRecordsFromSqlite();
  const openclawVersion = readOpenClawVersion();
  const cache = readCache(cachePath);

  const pending = listClawXPathOwnedPluginMirrors().flatMap((mirror) => {
    const record = records[mirror.pluginId];
    if (
      !record
      || record.source !== 'path'
      || typeof record.installPath !== 'string'
      || !existsSync(join(mirror.targetDir, 'openclaw.plugin.json'))
      || comparablePath(record.installPath) !== comparablePath(mirror.targetDir)
      || !isPluginExplicitlyEnabled(config, mirror.pluginId)
    ) {
      return [];
    }
    const fingerprint = recordFingerprint(openclawVersion, record);
    return cache.plugins[mirror.pluginId]?.fingerprint === fingerprint
      ? []
      : [{ pluginId: mirror.pluginId, fingerprint }];
  });

  if (pending.length === 0) {
    return { status: 'up-to-date', attempted: [], accepted: [] };
  }

  const pendingIds = pending.map((entry) => entry.pluginId);
  if (cache.gatewayReadyOpenClawVersion !== openclawVersion) {
    logger.info(`[plugin] Deferring capability consent for ${pendingIds.join(', ')} until the Gateway has started on OpenClaw ${openclawVersion}`);
    return { status: 'deferred', attempted: [], accepted: [] };
  }
  logger.info(`[plugin] Accepting declared capabilities for ClawX plugins: ${pendingIds.join(', ')}`);
  const batch = await enableWithConsent(pendingIds);

  // A current acceptance is left untouched by OpenClaw, so a successful
  // command, not a changed record, is what proves consent for an id.
  const succeeded = new Set<string>(batch.success ? pendingIds : []);
  let after = readPluginInstallRecordsFromSqlite();
  if (!batch.success) {
    for (const pluginId of pendingIds) {
      if (acceptanceChanged(records[pluginId], after[pluginId])) succeeded.add(pluginId);
    }
  }
  if (!batch.success && !batch.timedOut) {
    // The CLI stops at the first failing id; give the rest their own attempt.
    for (const pluginId of pendingIds) {
      if (succeeded.has(pluginId)) continue;
      if ((await enableWithConsent([pluginId])).success) succeeded.add(pluginId);
    }
    after = readPluginInstallRecordsFromSqlite();
  }

  const attemptedAt = new Date().toISOString();
  const accepted: string[] = [];
  for (const { pluginId, fingerprint } of pending) {
    const wasAccepted = succeeded.has(pluginId) && hasAcceptedSurface(after[pluginId]);
    if (wasAccepted) accepted.push(pluginId);
    cache.plugins[pluginId] = { fingerprint, attemptedAt, accepted: wasAccepted };
  }
  writeCache(cachePath, cache);

  if (accepted.length > 0) {
    logger.info(`[plugin] Accepted declared capabilities for ClawX plugins: ${accepted.join(', ')}`);
  }
  const failed = pendingIds.filter((pluginId) => !accepted.includes(pluginId));
  if (failed.length > 0) {
    logger.warn(`[plugin] Capability consent was not recorded for: ${failed.join(', ')}; OpenClaw will keep reporting them as requiring consent until \`openclaw plugins enable <id> --accept-capabilities\` succeeds`);
  }

  return {
    status: failed.length > 0 ? 'failed' : 'accepted',
    attempted: pendingIds,
    accepted,
  };
}
