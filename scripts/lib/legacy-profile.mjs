import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import JSON5 from 'json5';

export const LEGACY_VERSION = '2026.7.1-2';
const IGNORED_BACKUP_ROOTS = new Set(['backups', 'extensions', 'node_modules', 'logs', 'browser', 'plugin-runtime-deps', 'tools']);
const WORKSPACE_CACHE_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__']);

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function assertNoSymlinks(path) {
  for (let current = path; ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink in profile path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
}

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** Copy regular files only; SQLite online backup includes committed WAL data. */
async function copyTree(source, target, skip = () => false) {
  const info = await lstat(source);
  if (info.isSymbolicLink() || skip(basename(source))) return;
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(source)) await copyTree(join(source, entry), join(target, entry), skip);
  } else if (info.isFile() && !/\.sqlite-(wal|shm)$/.test(source)) {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    if (/\.sqlite$/.test(source)) {
      const db = new DatabaseSync(source, { readOnly: true });
      try { await backup(db, target); } finally { db.close(); }
    } else await copyFile(source, target);
  }
}

function rewriteValue(value, mappings) {
  if (typeof value === 'string') {
    for (const [source, target] of mappings) {
      if (value === source || value.startsWith(`${source}/`)) return target + value.slice(source.length);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => rewriteValue(item, mappings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteValue(item, mappings)]));
  return value;
}

export function legacyEnvironment(root, parent = process.env) {
  const env = Object.fromEntries(Object.entries(parent).filter(([key]) => !key.startsWith('OPENCLAW_') && !key.startsWith('CLAWX_E2E')));
  return {
    ...env,
    CLAWX_DEV_PROFILE: 'legacy', CLAWX_DEV_PROFILE_ROOT: root,
    CLAWX_USER_DATA_DIR: join(root, 'clawx'), CLAWX_CONFIG_DIR: join(root, 'clawx'),
    OPENCLAW_STATE_DIR: join(root, 'openclaw'), OPENCLAW_CONFIG_PATH: join(root, 'openclaw', 'openclaw.json'),
    OPENCLAW_GATEWAY_PORT: '19789', CLAWX_PORT_OPENCLAW_GATEWAY: '19789',
    OPENCLAW_SKIP_CHANNELS: '1', VITE_CLAWX_DEV_PROFILE: 'legacy',
    CLAWX_REMOTE_DEBUGGING_PORT: '9224',
  };
}

/** Preparation never mutates the shared state, source snapshot or an existing profile. */
export async function prepareLegacyProfile({
  root = join(homedir(), '.clawx-dev', 'legacy'),
  sourceState = join(homedir(), '.openclaw'),
  snapshot = join(sourceState, 'backups', 'clawx-openclaw-2026.10.5-pre-migration'),
  backupRoot = join(dirname(root), 'backups'), runtimeVersion = LEGACY_VERSION,
  preferences = {},
} = {}) {
  root = resolve(root); sourceState = resolve(sourceState); snapshot = resolve(snapshot); backupRoot = resolve(backupRoot);
  if (runtimeVersion !== LEGACY_VERSION) throw new Error(`dev:legacy requires OpenClaw ${LEGACY_VERSION}`);
  if (inside(sourceState, root) || inside(root, sourceState) || inside(sourceState, backupRoot) || inside(root, backupRoot)) {
    throw new Error('Legacy profile and backup must be outside shared runtime data');
  }
  for (const path of [root, sourceState, snapshot, backupRoot]) await assertNoSymlinks(path);
  const markerPath = join(root, 'profile.json');
  if (await exists(root)) {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.name !== 'legacy' || marker.runtimeVersion !== runtimeVersion) throw new Error('Existing legacy profile has an incompatible manifest');
    for (const path of [join(root, 'openclaw'), join(root, 'clawx'), join(root, 'openclaw', 'openclaw.json')]) await assertNoSymlinks(path);
    const cfg = JSON5.parse(await readFile(join(root, 'openclaw', 'openclaw.json'), 'utf8'));
    if (cfg.meta?.lastTouchedVersion && cfg.meta.lastTouchedVersion !== runtimeVersion) throw new Error('Legacy profile was written by another runtime; preserve it and inspect before starting');
    return { root, backup: marker.backup, reused: true };
  }
  const manifest = JSON.parse(await readFile(join(snapshot, 'snapshot.json'), 'utf8'));
  if (manifest.upgrade !== 'openclaw-2026.10.5' || !Array.isArray(manifest.files) || !manifest.files.includes('config/openclaw.json')) throw new Error('Invalid pre-migration snapshot');
  const config = JSON5.parse(await readFile(join(snapshot, 'config', 'openclaw.json'), 'utf8'));
  if (config.meta?.lastTouchedVersion !== runtimeVersion) throw new Error('Snapshot config version does not match the legacy runtime');

  // Preserve migrated auth, history, SQLite state and workspaces before preparing legacy.
  const destination = join(backupRoot, `migrated-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const backupTemp = `${destination}.tmp`;
  await mkdir(backupTemp, { recursive: true, mode: 0o700 });
  try {
    for (const entry of await readdir(sourceState)) {
      if (!IGNORED_BACKUP_ROOTS.has(entry)) await copyTree(join(sourceState, entry), join(backupTemp, entry), name => WORKSPACE_CACHE_DIRS.has(name));
    }
    await writeJson(join(backupTemp, 'backup-manifest.json'), { sourceState, createdAt: new Date().toISOString(), runtimeVersion, sqlite: 'online-backup' });
    await rename(backupTemp, destination);
  } catch (error) { await rm(backupTemp, { recursive: true, force: true }); throw error; }

  const temp = `${root}.tmp-${randomUUID()}`;
  try {
    const stateDir = join(root, 'openclaw');
    const stageState = join(temp, 'openclaw');
    const expandSource = path => path?.replace(/^~(?=[/\\]|$)/, homedir());
    const agents = config.agents?.list?.length ? config.agents.list : [{ id: 'main' }];
    const mappings = [[sourceState, stateDir], ['~/.openclaw', stateDir]];
    for (const agent of agents) {
      if (!/^[\w-]+$/.test(agent.id)) throw new Error('Unsafe agent id in snapshot');
      const sourceWorkspace = expandSource(agent.workspace || config.agents?.defaults?.workspace || join(sourceState, agent.id === 'main' ? 'workspace' : `workspace-${agent.id}`));
      const targetWorkspace = join(stateDir, agent.id === 'main' ? 'workspace' : `workspace-${agent.id}`);
      mappings.unshift([sourceWorkspace, targetWorkspace]);
      const stageWorkspace = join(stageState, relative(stateDir, targetWorkspace));
      if (await exists(sourceWorkspace)) await copyTree(sourceWorkspace, stageWorkspace, name => WORKSPACE_CACHE_DIRS.has(name));
      else await mkdir(stageWorkspace, { recursive: true, mode: 0o700 });
      agent.workspace = targetWorkspace;
      agent.agentDir = join(stateDir, 'agents', agent.id, 'agent');
      const sourceAgent = join(snapshot, 'agents', agent.id, 'agent');
      const targetAgent = join(stageState, 'agents', agent.id, 'agent');
      for (const name of ['models.json', 'auth-profiles.json']) {
        if (!await exists(join(sourceAgent, name))) continue;
        const value = JSON5.parse(await readFile(join(sourceAgent, name), 'utf8'));
        if (name === 'auth-profiles.json') {
          value.profiles = Object.fromEntries(Object.entries(value.profiles ?? {}).filter(([, credential]) => credential.type === 'api_key'));
          delete value.order; delete value.lastGood; delete value.usageStats;
        }
        await writeJson(join(targetAgent, name), rewriteValue(value, mappings));
      }
    }
    config.agents ??= {}; config.agents.list = agents;
    const rewritten = rewriteValue(config, mappings);
    rewritten.agents.defaults ??= {};
    rewritten.agents.defaults.workspace = join(stateDir, 'workspace');
    rewritten.channels = {}; rewritten.bindings = []; rewritten.plugins = {};
    rewritten.cron = { enabled: false };
    rewritten.tools ??= {}; rewritten.tools.web ??= {};
    rewritten.tools.web.search = { enabled: false };
    rewritten.gateway ??= {}; rewritten.gateway.port = 19789;
    delete rewritten.gateway.remote;
    rewritten.browser = { enabled: false };
    await writeJson(join(stageState, 'openclaw.json'), rewritten);
    await writeJson(join(temp, 'clawx', 'settings.json'), {
      language: preferences.language || 'zh', theme: preferences.theme || 'system',
      gatewayPort: 19789, telemetryEnabled: false, autoCheckUpdate: false,
      computerUseEnabled: false, launchAtStartup: false,
      chatWorkspacePath: join(stateDir, 'workspace'), recentWorkspacePaths: [join(stateDir, 'workspace')],
    });
    await writeJson(join(temp, 'profile.json'), {
      name: 'legacy', runtimeVersion, snapshot, backup: destination, createdAt: new Date().toISOString(),
      sourceConfigHash: createHash('sha256').update(await readFile(join(sourceState, 'openclaw.json'))).digest('hex'),
      sessions: 'fresh', credentials: 'static-api-keys-only',
    });
    await rename(temp, root);
    return { root, backup: destination, reused: false };
  } catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
}
