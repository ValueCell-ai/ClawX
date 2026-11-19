import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import JSON5 from 'json5';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : {};
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const primary = (value: unknown) => string(value) ?? string(record(value).primary);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export type CronInferenceMigrationEntry = {
  jobId: string;
  definition: RecordValue;
  agentId: string;
  model: string;
  profileId: string;
  credentialDigest: string;
};

export async function openCronSnapshot(snapshotDir: string) {
  const root = await realpath(snapshotDir);
  const manifest = record(JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8')));
  if (manifest.formatVersion !== 2 || manifest.upgrade !== 'openclaw-2026.10.10') {
    throw new Error('Unsupported cron migration snapshot');
  }
  const fileInfo = record(manifest.fileInfo);
  const files = Object.keys(fileInfo);
  const verified = new Map<string, string>();
  const within = (parent: string, child: string) => {
    const rel = relative(parent, child);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  async function verifiedPath(name: string): Promise<string> {
    const cached = verified.get(name);
    if (cached) return cached;
    const path = resolve(root, name);
    if (!within(root, path) || !(await lstat(path)).isFile() || !within(root, await realpath(path))) {
      throw new Error('Unsafe cron migration snapshot path');
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const digest = hash.digest('hex');
    if (digest !== record(fileInfo[name]).sha256) throw new Error('Cron migration snapshot integrity check failed');
    verified.set(name, path);
    return path;
  }
  const find = (name: string) => files.find(file => file.replaceAll('\\', '/') === name);
  async function json(name: string): Promise<RecordValue> {
    return record(JSON5.parse(await readFile(await verifiedPath(name), 'utf8')));
  }
  async function database<T>(name: string, read: (db: DatabaseSync) => T): Promise<T> {
    const db = new DatabaseSync(await verifiedPath(name), { readOnly: true });
    try { return read(db); } finally { db.close(); }
  }
  const hasTable = (db: DatabaseSync, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const configFile = files.find(file => /^config[/\\][^/\\]+$/.test(file));
  const loadJobs = async () => {
    const stateFile = find('state-files/state/openclaw.sqlite');
    if (stateFile) {
      const stored = await database(stateFile, db => {
        if (!hasTable(db, 'cron_jobs')) return undefined;
        const columns = db.prepare("PRAGMA table_info(cron_jobs)").all();
        return { jobs: db.prepare('SELECT job_json FROM cron_jobs').all().map(row => record(JSON.parse(String(row.job_json)))),
          legacy: columns.some(column => column.name === 'payload_timeout_seconds') };
      });
      if (stored) return stored;
    }
    const cronFile = find('state-files/cron/jobs.json');
    const data = cronFile ? await json(cronFile) : {};
    return { jobs: Array.isArray(data.jobs) ? data.jobs.map(record) : [], legacy: !!cronFile };
  };
  let jobs: ReturnType<typeof loadJobs> | undefined;
  const readJobs = () => jobs ??= loadJobs();
  return { root, manifest, within, find, json, database, hasTable, configFile, readJobs };
}

function historicalAgentConfig(cfg: RecordValue) {
  const agentConfig = record(cfg.agents);
  const agents: RecordValue[] = Array.isArray(agentConfig.list) ? agentConfig.list.map(record)
    : Object.entries(record(agentConfig.entries)).map(([id, entry]) => ({ ...record(entry), id }));
  const defaults = record(agentConfig.defaults);
  const defaultAgents = agents.filter(agent => agent.default === true);
  const defaultId = string(agentConfig.default) ?? (defaultAgents.length === 1 ? string(defaultAgents[0].id) : undefined)
    ?? (agents.length === 0 ? 'main' : agents.length === 1 ? string(agents[0].id) : undefined);
  return { agents, defaults, defaultId };
}

/** No credentials are copied into the launch manifest. All evidence is immutable snapshot data. */
export async function prepareCronInferenceMigration(snapshotDir: string, snapshot = openCronSnapshot(snapshotDir)): Promise<{
  manifestPath?: string; eligible: number; skipped: number;
}> {
  const { root, manifest, within, find, json, database, hasTable, configFile, readJobs } = await snapshot;
  const cell = (db: DatabaseSync, key: string): RecordValue | undefined => {
    if (!hasTable(db, 'config_machine_state')) return undefined;
    const row = db.prepare('SELECT value_json FROM config_machine_state WHERE state_key=?').get(key);
    return typeof row?.value_json === 'string' ? record(JSON.parse(row.value_json)) : undefined;
  };
  if (!configFile) return { eligible: 0, skipped: 0 };
  const cfg = await json(configFile);
  const { agents, defaults, defaultId } = historicalAgentConfig(cfg);
  const stateFile = find('state-files/state/openclaw.sqlite');
  const { jobs } = await readJobs();
  let sharedProfiles: RecordValue | undefined;
  if (stateFile) await database(stateFile, db => {
    const owner = cell(db, 'auth.sharedStore');
    if (owner?.location === 'state-db') sharedProfiles = record(cell(db, 'authProfiles.store')?.profiles);
    else if (owner && owner.location !== 'legacy-main') throw new Error('Invalid snapshot auth store owner');
  });
  const stores = new Map<string, RecordValue>();
  function authBackupPrefix(agentId: string): string | undefined {
    const agent = agents.find(item => item.id === agentId);
    const customDir = string(agent?.agentDir);
    if (!customDir) return `agents/${agentId}/agent`;
    const roots = Array.isArray(manifest.restoreRoots) ? manifest.restoreRoots.map(record) : [];
    const historicalDir = resolve(customDir.startsWith('~/') ? join(homedir(), customDir.slice(2)) : customDir);
    const sourceRoot = roots.filter(item => typeof item.source === 'string' && typeof item.backup === 'string'
      && item.existed === true && item.directory === true && within(item.source, historicalDir))
      .sort((a, b) => String(b.source).length - String(a.source).length)[0];
    if (!sourceRoot) return undefined;
    return join(String(sourceRoot.backup), relative(String(sourceRoot.source), historicalDir)).replaceAll('\\', '/');
  }
  async function hasHistoricalSessionOverride(agentId: string, jobId: string, selectedProfile: string): Promise<boolean> {
    // Session model/account overrides belong to the old conversation, not the
    // agent default. Without that complete selection provenance, do not guess.
    // A custom session-store projection requires separate historical routing
    // evidence; absence from the default store cannot prove no override.
    if (string(record(cfg.session).store)) return true;
    const prefix = authBackupPrefix(agentId);
    if (!prefix) return true;
    // Doctor canonicalizes the unqualified legacy key during upgrades. Both
    // shapes are historical selection evidence, even if only one survives now.
    const sessionKeys = [`agent:${agentId}:cron:${jobId}`, `cron:${jobId}`];
    const hasOverride = (stored: RecordValue) => {
      if (stored.modelSelectionLocked === true || ['modelOverride', 'providerOverride'].some(key => string(stored[key]))) return true;
      const profile = string(stored.authProfileOverride);
      const source = stored.authProfileOverrideSource ?? (typeof stored.authProfileOverrideCompactionCount === 'number' ? 'auto' : 'user');
      // A normal successful cron run records an automatic profile pin. It is
      // consistent evidence only when the uniquely proven account is unchanged.
      return !!profile && (profile !== selectedProfile || source !== 'auto');
    };
    const sqliteFile = find(`${prefix}/openclaw-agent.sqlite`);
    if (sqliteFile) {
      const stored = await database(sqliteFile, db => {
        if (!hasTable(db, 'session_nodes')) return undefined;
        const rows = db.prepare('SELECT entry_json FROM session_nodes WHERE session_key IN (?,?)').all(...sessionKeys);
        return rows.some(row => typeof row.entry_json === 'string' && hasOverride(record(JSON.parse(row.entry_json))));
      });
      if (stored !== undefined) return stored;
    }
    const sessionsFile = find(`agents/${agentId}/sessions/sessions.json`);
    if (!sessionsFile) return false;
    const sessions = await json(sessionsFile);
    return sessionKeys.some(key => hasOverride(record(sessions[key])));
  }
  async function profilesFor(agentId: string): Promise<RecordValue> {
    if (agentId === 'main' && sharedProfiles) return sharedProfiles;
    if (stores.has(agentId)) return stores.get(agentId)!;
    const prefix = authBackupPrefix(agentId);
    if (!prefix) return {};
    let profiles: RecordValue | undefined;
    const sqliteFile = find(`${prefix}/openclaw-agent.sqlite`);
    if (sqliteFile) profiles = await database(sqliteFile, db => {
      if (!hasTable(db, 'auth_profile_store')) return undefined;
      const row = db.prepare("SELECT store_json FROM auth_profile_store WHERE store_key='primary'").get();
      return typeof row?.store_json === 'string' ? record(record(JSON.parse(row.store_json)).profiles) : undefined;
    });
    if (!profiles) {
      const jsonFile = find(`${prefix}/auth-profiles.json`);
      if (jsonFile) profiles = record((await json(jsonFile)).profiles);
    }
    const result = profiles ?? {};
    stores.set(agentId, result);
    return result;
  }
  const entries: CronInferenceMigrationEntry[] = [];
  let skipped = 0;
  for (const job of jobs) {
    const payload = record(job.payload);
    if (payload.kind !== 'agentTurn' || job.sessionTarget !== 'isolated' || Object.hasOwn(job, 'declarationKey')
      || Object.hasOwn(job, 'inferenceBinding') || Object.hasOwn(job, 'runtimeAuthority')) continue;
    const jobId = string(job.id);
    const agentId = string(job.agentId) ?? string(job.sessionKey)?.match(/^agent:([^:]+):/)?.[1] ?? defaultId;
    if (!jobId || !agentId || !/^[\w-]+$/.test(agentId)) { skipped++; continue; }
    if (!string(payload.model) && payload.externalContentSource === 'gmail'
      && primary(record(record(cfg.hooks).gmail).model)) { skipped++; continue; }
    const agent = agents.find(item => item.id === agentId);
    let model = string(payload.model) ?? primary(record(agent?.subagents).model)
      ?? primary(record(defaults.subagents).model) ?? primary(agent?.model) ?? primary(defaults.model);
    if (!model) { skipped++; continue; }
    let profileId: string | undefined;
    const at = model.lastIndexOf('@');
    if (at > 0) { profileId = model.slice(at + 1); model = model.slice(0, at); }
    if (!model.includes('/')) {
      const aliases = Object.entries(record(defaults.models)).filter(([, value]) => record(value).alias === model);
      if (aliases.length === 1) model = aliases[0][0];
    }
    if (!model.includes('/')) { skipped++; continue; }
    const provider = model.slice(0, model.indexOf('/'));
    const localProfiles = await profilesFor(agentId);
    // Runtime inheritance merges by profile id, not provider. Distinct local
    // and shared accounts must remain ambiguous unless explicitly selected.
    const profiles = agentId === 'main' ? localProfiles : { ...await profilesFor('main'), ...localProfiles };
    let matches = Object.entries(profiles).filter(([id, value]) => record(value).provider === provider && (!profileId || profileId === id));
    if (matches.length === 0 && !profileId) {
      const key = record(record(record(cfg.models).providers)[provider]).apiKey;
      if (typeof key === 'string' && key.trim() && !key.includes('${')) matches = [[`${provider}:default`, { type: 'api_key', provider, key }]];
    }
    if (matches.length !== 1) { skipped++; continue; }
    const [selectedProfile, credential] = matches[0];
    if (await hasHistoricalSessionOverride(agentId, jobId, selectedProfile)) { skipped++; continue; }
    const value = record(credential);
    if (!(value.type === 'api_key' && typeof value.key === 'string')
      && !(value.type === 'oauth' && typeof value.access === 'string')) { skipped++; continue; }
    entries.push({ jobId, definition: job, agentId, model, profileId: selectedProfile,
      credentialDigest: createHash('sha256').update(stableJson(credential)).digest('hex') });
  }
  if (!entries.length) return { eligible: 0, skipped };
  const manifestPath = join(dirname(root), 'clawx-cron-inference-migration.json');
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, jobs: entries }), { mode: 0o600 });
  await rename(temporary, manifestPath);
  return { manifestPath, eligible: entries.length, skipped };
}

// OpenClaw's finiteSecondsToTimerSafeMilliseconds reserves headroom below Node's 32-bit timer.
const MAX_CRON_TIMER_SECONDS = 2_147_000;

/** Select a single literal launcher command. A task description alone cannot identify an exec call. */
function legacyWorkerLauncher(job: RecordValue): { command: string; timeoutSeconds: number } | undefined {
  const payload = record(job.payload);
  if (job.sessionTarget !== 'isolated' || payload.kind !== 'agentTurn' || Object.hasOwn(job, 'declarationKey')) return;
  if (payload.toolsAllow !== undefined && (!Array.isArray(payload.toolsAllow)
    || !payload.toolsAllow.some(tool => tool === 'exec' || tool === 'group:runtime' || tool === '*'))) return;
  const message = string(payload.message);
  const contract = [message, string(job.description)].filter(Boolean).join('\n');
  if (!message || !/(?:独立\s*(?:worker|进程)|后台(?:运行|执行|启动)|不(?:再)?等待.{0,12}(?:完成|结束)|(?:independent|background|detached)\s+(?:worker|process)|(?:do not|don't|without)\s+wait(?:ing)?)/iu.test(contract)) return;
  const lines = message.split(/\r?\n|[：。；]/u);
  const candidates: string[] = [];
  for (const line of lines) {
    // Allow an inline English instruction before the command. Keep Windows drive letters intact.
    const raw = line.replace(/^[^"'\\/\n]*?:[ \t]+/, '').trim().replace(/^\x60([^\x60]*)\x60$/u, '$1').trim();
    const command = /^(?:(?<interpreter>(?:uv(?:\.exe)?\s+run\s+)?python(?:w|3(?:\.\d+)?)?(?:\.exe)?|node(?:\.exe)?|(?:pwsh|powershell)(?:\.exe)?\s+-File)\s+)?(?:"(?<quoted>[^"]+)"|'(?<single>[^']+)'|(?<plain>[^\s"']+))\s+(?<args>.+)$/iu.exec(raw)?.groups;
    if (!command || !/(?:^|\s)--start(?:\s|$)/u.test(command.args) || /[;&|<>\x60$%]/u.test(raw)) continue;
    const script = command.quoted ?? command.single ?? command.plain;
    if (!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)/iu.test(script)) continue;
    const extension = command.interpreter === undefined ? /\.(?:exe|cmd|bat)$/iu
      : /python/iu.test(command.interpreter) ? /\.pyw?$/iu
      : /^node/iu.test(command.interpreter) ? /\.(?:[cm]?js)$/iu : /\.ps1$/iu;
    if (!extension.test(script)) continue;
    candidates.push(raw);
  }
  if (candidates.length !== 1 || !string(job.id)) return;
  const command = candidates[0];
  const current = payload.timeoutSeconds;
  if (current !== undefined && current !== 60) return;
  // Only an explicitly named overall or exec-tool deadline is evidence of a larger budget.
  // Script options for refresh, delivery and retry phases do not describe the whole job.
  const budgets = [
    ...command.matchAll(/(?:^|\s)--(?:overall|total)-timeout-seconds(?:=|\s+)(\d+)(?=\s|$)/giu),
    ...message.matchAll(/\bexec\.(?:timeoutSeconds|timeout)\s*[:=]\s*(\d+)\b/giu),
  ].map(match => Math.min(Number(match[1]), MAX_CRON_TIMER_SECONDS)).filter(value => value > 0);
  const explicit = budgets.reduce((max, value) => Math.max(max, value), 0);
  return { command, timeoutSeconds: explicit ? Math.max(Number(current ?? 0), explicit) : 3600 };
}

export async function prepareCronTimeoutMigration(snapshotDir: string, snapshot = openCronSnapshot(snapshotDir)): Promise<{ manifestPath?: string; eligible: number }> {
  const { root, readJobs, configFile, json } = await snapshot;
  const cfg = configFile ? await json(configFile) : {};
  const version = string(record(cfg.meta).lastTouchedVersion);
  const parts = version?.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:[-+.]|$)/);
  const datedVersion = parts ? Number(parts[1]) * 10000 + Number(parts[2]) * 100 + Number(parts[3]) : undefined;
  if (datedVersion !== undefined && datedVersion >= 20261010) return { eligible: 0 };
  const { jobs, legacy } = await readJobs();
  if (datedVersion === undefined && !legacy) return { eligible: 0 };
  const { defaultId } = historicalAgentConfig(cfg);
  const entries = jobs.flatMap(definition => {
    const agentId = string(definition.agentId) ?? string(definition.sessionKey)?.match(/^agent:([^:]+):/)?.[1] ?? defaultId;
    const launcher = legacyWorkerLauncher(definition);
    return launcher ? [{ jobId: definition.id, definition, agentId, ...launcher }] : [];
  });
  if (!entries.length) return { eligible: 0 };
  const manifestPath = join(dirname(root), 'clawx-cron-timeout-migration.json');
  const temporary = manifestPath + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify({ version: 1, jobs: entries }), { mode: 0o600 });
  await rename(temporary, manifestPath);
  return { manifestPath, eligible: entries.length };
}
