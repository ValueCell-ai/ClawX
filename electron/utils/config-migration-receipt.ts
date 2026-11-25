import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSON5 from 'json5';
import { isRecord } from '../services/payload-utils';

const upgrade = 'openclaw-2026.10.10';
const provider = 'custom-enterpri';
const aliases = { 'dingtalk-connector': 'dingtalk', 'wecom-openclaw-plugin': 'wecom' };
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
const maxConfigBytes = 8 * 1024 * 1024;
type Config = Record<string, unknown>;
type Receipt = { configPath: string; sourceBytes: number; sourceHash: string; lastGoodHash: string; migratedHash: string; previousMigratedHash?: string };

function child(row: unknown, key: string): Config | undefined {
  return isRecord(row) && isRecord(row[key]) ? row[key] : undefined;
}

function hasLegacyShape(config: Config): boolean {
  const agents = child(config, 'agents');
  const list = agents?.list;
  if (Array.isArray(list) && !agents?.entries && list.length && list.every(row => isRecord(row) && typeof row.id === 'string')) return true;
  const channels = child(config, 'channels');
  const entries = child(child(config, 'plugins'), 'entries');
  return Object.keys(aliases).some(key => child(channels, key) || child(entries, key));
}

function normalizeAliases(config: Config): boolean {
  const plugins = child(config, 'plugins');
  for (const [alias, id] of Object.entries(aliases)) {
    for (const row of [child(config, 'channels'), child(plugins, 'entries')]) {
      if (!row || !Object.hasOwn(row, alias)) continue;
      if (Object.hasOwn(row, id)) return false;
      row[id] = row[alias];
      delete row[alias];
    }
    if (plugins && Array.isArray(plugins.allow) && plugins.allow.includes(alias)) {
      if (plugins.allow.includes(id)) return false;
      plugins.allow = plugins.allow.map(key => key === alias ? id : key);
    }
  }
  return true;
}

function isGeneratedSelection(value: unknown, catalog: Set<string>): boolean {
  if (typeof value === 'string') return catalog.has(value);
  return isRecord(value) && typeof value.primary === 'string' && catalog.has(value.primary)
    && Object.keys(value).every(key => key === 'primary' || key === 'fallbacks')
    && (value.fallbacks === undefined || (Array.isArray(value.fallbacks) && value.fallbacks.every(ref => catalog.has(ref))));
}

// 0.6.1 removes its own model projection on quit. Every other setting,
// including credential values, must agree with the native healthy image.
function isHealthySource(source: Config, good: Config): boolean {
  if (!hasLegacyShape(source) || child(source, 'gateway')?.mode !== 'local'
    || !normalizeAliases(source) || !normalizeAliases(good)) return false;
  const sourceProviders = child(child(source, 'models'), 'providers');
  const goodProviders = child(child(good, 'models'), 'providers');
  const runtime = child(goodProviders, provider);
  if (sourceProviders && goodProviders && !Object.hasOwn(sourceProviders, provider) && Array.isArray(runtime?.models)) {
    const catalog = new Set<string>();
    for (const model of runtime.models) {
      if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim()) return false;
      catalog.add(provider + '/' + model.id);
    }
    delete goodProviders[provider];
    const goodAgents = child(good, 'agents'), sourceAgents = child(source, 'agents');
    const goodDefaults = child(goodAgents, 'defaults'), sourceDefaults = child(sourceAgents, 'defaults');
    const allowed = child(goodDefaults, 'models');
    if (allowed && goodDefaults && sourceDefaults && !Object.hasOwn(sourceDefaults, 'models')
      && Object.keys(allowed).length === catalog.size && Object.keys(allowed).every(key => catalog.has(key))) delete goodDefaults.models;
    const stripSelection = (left: unknown, right: unknown) => {
      if (isRecord(left) && isRecord(right) && !Object.hasOwn(left, 'model') && isGeneratedSelection(right.model, catalog)) delete right.model;
    };
    stripSelection(sourceDefaults, goodDefaults);
    if (Array.isArray(sourceAgents?.list) && Array.isArray(goodAgents?.list)) {
      const rows = sourceAgents.list;
      goodAgents.list.forEach((row, i) => stripSelection(rows[i], row));
    }
  }
  return isDeepStrictEqual(source, good);
}

async function regularText(file: string, maxBytes = maxConfigBytes): Promise<string | undefined> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > maxBytes) return;
    const bytes = await readFile(file);
    if (bytes.length <= maxBytes) return bytes.toString('utf8');
  } catch { /* Optional migration evidence is unavailable. */ }
}

function parse(raw?: string): Config | undefined {
  if (!raw) return;
  try {
    const record: unknown = JSON5.parse(raw);
    if (isRecord(record)) return record;
  } catch { /* An invalid snapshot cannot attest a migration. */ }
}

async function verifiedOrigin(configPath: string, stateDir: string) {
  if (dirname(configPath) !== stateDir) return;
  const dir = join(stateDir, 'backups', 'clawx-' + upgrade + '-pre-migration');
  const configKey = join('config', basename(configPath));
  const goodKey = join('state-files', basename(configPath) + '.last-good');
  const manifest = parse(await regularText(join(dir, 'snapshot.json'), 64 * 1024 * 1024));
  if (manifest?.upgrade !== upgrade || manifest.formatVersion !== 2 || manifest.configPath !== configPath
    || manifest.stateDir !== stateDir || !Array.isArray(manifest.files)
    || !manifest.files.includes(configKey) || !manifest.files.includes(goodKey)) return;
  const physicalPaths = await Promise.all(
    [stateDir, dir, join(dir, configKey), join(dir, goodKey)].map(p => realpath(p)),
  ).catch(() => undefined);
  if (!physicalPaths) return;
  const [state, snapshot, configImage, goodImage] = physicalPaths;
  if (relative(state, snapshot) !== relative(stateDir, dir) || relative(snapshot, configImage) !== configKey
    || relative(snapshot, goodImage) !== goodKey) return;
  const [raw, healthy, liveGood] = await Promise.all([
    regularText(configImage), regularText(goodImage), regularText(configPath + '.last-good'),
  ]);
  if (!raw || !healthy || healthy !== liveGood) return;
  const sourceBytes = Buffer.byteLength(raw);
  const goodBytes = Buffer.byteLength(healthy);
  if (goodBytes < 512 || sourceBytes < Math.floor(goodBytes / 2)) return;
  const sourceHash = hash(raw), lastGoodHash = hash(healthy);
  if (child(manifest.fileInfo, configKey)?.sha256 !== sourceHash || child(manifest.fileInfo, goodKey)?.sha256 !== lastGoodHash) return;
  const source = parse(raw), good = parse(healthy);
  if (source && good && isHealthySource(source, good)) return { configPath, sourceBytes, sourceHash, lastGoodHash };
}

async function publish(path: string, receipt: Receipt): Promise<void> {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Called only for offline prelaunch transactions, before their final config-byte comparison and rename. */
export async function prepareConfigMigrationReceipt(configPath: string, stateDir: string, before: string, after: string): Promise<void> {
  if (configPath !== resolve(configPath) || stateDir !== resolve(stateDir)) return;
  const receiptPath = configPath + '.clawx-2026.10.10-migration.json';
  const current = parse(await regularText(receiptPath, 4096));
  const beforeHash = hash(before);
  const candidate = current?.configPath === configPath && [current.migratedHash, current.previousMigratedHash].includes(beforeHash) ? current : undefined;
  if (!candidate) {
    const input = parse(before);
    if (!input || !hasLegacyShape(input)) return;
  }
  const origin = await verifiedOrigin(configPath, stateDir);
  if (!origin) return;
  const firstWrite = beforeHash === origin.sourceHash;
  if (!firstWrite && (!candidate || candidate.sourceHash !== origin.sourceHash || candidate.sourceBytes !== origin.sourceBytes
    || candidate.lastGoodHash !== origin.lastGoodHash)) return;
  const migratedHash = hash(after);
  if (current?.migratedHash === migratedHash && current.configPath === configPath && current.sourceHash === origin.sourceHash
    && current.sourceBytes === origin.sourceBytes && current.lastGoodHash === origin.lastGoodHash) return;
  // Publish before the config rename. A crash between renames leaves the
  // preceding proven bytes live; both heads can then resume this migration.
  await publish(receiptPath, { ...origin, migratedHash, ...(!firstWrite && { previousMigratedHash: beforeHash }) });
}
