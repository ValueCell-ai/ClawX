// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const runtimeDir = path.resolve('node_modules/openclaw/dist');
const requireRuntime = createRequire(import.meta.url);
const runtime = requireRuntime(path.join(runtimeDir, 'clawx-cron-inference-migration.mjs')) as Json;
const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

async function fixture(agentId = 'main') {
  const home = await mkdtemp(path.join(tmpdir(), 'clawx-cron-migration-'));
  homes.push(home);
  const job: Json = {
    id: 'legacy-water', name: 'Drink water', agentId, enabled: true, createdAtMs: 100, updatedAtMs: 100,
    schedule: { kind: 'every', everyMs: 60_000 }, sessionTarget: 'isolated', wakeMode: 'next-heartbeat',
    payload: { kind: 'agentTurn', message: 'Drink water' }, delivery: { mode: 'none' },
    state: { nextRunAtMs: 1000, lastError: 'old failure' },
  };
  const credential = { type: 'api_key', provider: 'custom-enterpri', key: 'synthetic-key' };
  const entry: Json = {
    jobId: job.id, definition: structuredClone(job), model: 'custom-enterpri/old-model',
    profileId: 'custom-enterpri:default', credentialDigest: runtime.stableCredentialDigest(credential),
  };
  const manifestPath = path.join(home, 'migration.json');
  const save = async (entries = [entry]) => writeFile(manifestPath, JSON.stringify({ version: 1, jobs: entries }));
  await save();
  const cfg: Json = { model: 'custom-enterpri/new-model', owner: agentId };
  const session: Json = {};
  const authority = { assertCurrent: vi.fn(), dispose: vi.fn() };
  const binding = { version: 1, provider: credential.provider, profileId: entry.profileId, authorizationId: 'b'.repeat(64), authRequirement: 'api-key', source: 'user' };
  const beforeCommit = { fn: undefined as (() => void) | undefined };
  const cron = {
    readJob: vi.fn(async () => structuredClone(job)),
    updateWithPrecondition: vi.fn(async (_id: string, patch: Json, precondition: (job: Json) => void, options: Json) => {
      beforeCommit.fn?.();
      precondition(structuredClone(job));
      options.commitGuard();
      Object.assign(job, patch, { inferenceBinding: options.inferenceBinding });
    }),
  };
  const adapters = {
    isPersonalProfile: (id: string) => id.startsWith('user:'),
    waitForStartup: vi.fn(async () => {}),
    resolveAgentId: ({ cfg: current, job: currentJob }: Json) => currentJob.agentId ?? current.owner,
    readSession: vi.fn(() => session),
    resolveSelection: ({ cfg: current }: Json) => {
      const slash = current.model.indexOf('/');
      return { provider: current.model.slice(0, slash), modelId: current.model.slice(slash + 1), agentDir: home };
    },
    readStore: vi.fn(async () => ({ profiles: { [entry.profileId]: credential } })),
    capture: vi.fn(async (args: Json) => { args.retainAuthorization(authority); return binding; }),
  };
  const log = { warn: vi.fn(), info: vi.fn() };
  const run = () => runtime.migrateClawxCronInference({ cron, getConfig: () => cfg, env: { CLAWX_CRON_MIGRATION_MANIFEST: manifestPath }, log }, adapters);
  const continuity = async (source = 'user') => {
    const previous = { ...binding, source, authorizationId: 'a'.repeat(64) };
    job.inferenceBinding = previous;
    entry.definition.inferenceBinding = previous;
    entry.expectedPreviousBinding = previous;
    await save();
  };
  return { job, entry, credential, cfg, session, authority, binding, cron, adapters, log, run, save, beforeCommit, continuity };
}

describe('pinned OpenClaw legacy cron account migration', () => {
  it('loads the exact native capture contract, not the authorization reacquisition function', async () => {
    const adapters = await runtime.loadClawxCronMigrationAdapters();
    expect(adapters.capture.name).toBe('captureCronInferenceBinding');
    expect(adapters.readStore.name).toBe('ensureAuthProfileStoreAsync');
    expect(adapters.waitForStartup()).toBeUndefined();
    const cfg = { agents: { defaults: { systemAgent: { agentId: 'secondary' } }, list: [{ id: 'main' }, { id: 'secondary' }] } };
    expect(adapters.resolveAgentId({ cfg, job: {} })).toBe('secondary');
    expect(adapters.resolveAgentId({ cfg, job: { sessionKey: 'agent:main:cron:water' } })).toBe('main');
    expect(adapters.resolveAgentId({ cfg, job: { agentId: 'main' } })).toBe('main');
  }, 20_000);

  it('does no work without a managed-host manifest', async () => {
    const readJob = vi.fn();
    expect(await runtime.migrateClawxCronInference({ cron: { readJob }, env: {} })).toEqual({ migrated: 0, skipped: 0 });
    expect(readJob).not.toHaveBeenCalled();
  });

  it('joins native startup preparation before capturing any credential or session owner', async () => {
    const f = await fixture();
    let finishPreparation!: () => void;
    let enteredPreparation!: () => void;
    const entered = new Promise<void>(resolve => { enteredPreparation = resolve; });
    const preparation = new Promise<void>(resolve => { finishPreparation = resolve; });
    f.adapters.waitForStartup.mockImplementation(async () => { enteredPreparation(); await preparation; });
    const migration = f.run();
    await entered;
    expect(f.cron.readJob).not.toHaveBeenCalled();
    expect(f.adapters.readSession).not.toHaveBeenCalled();
    expect(f.adapters.readStore).not.toHaveBeenCalled();
    expect(f.adapters.capture).not.toHaveBeenCalled();
    finishPreparation();
    expect(await migration).toEqual({ migrated: 1, skipped: 0 });
    expect(f.adapters.waitForStartup).toHaveBeenCalledOnce();
  });

  it.each(['main', 'secondary'])('binds %s once with its updated model and preserves inheritance/run state', async (agentId) => {
    const f = await fixture(agentId);
    const before = structuredClone(f.job);
    expect(await f.run()).toEqual({ migrated: 1, skipped: 0 });
    expect(f.adapters.capture).toHaveBeenCalledWith(expect.objectContaining({ agentId, model: 'custom-enterpri/new-model@custom-enterpri:default' }));
    expect(f.job).toEqual({ ...before, inferenceBinding: f.binding });
    expect(f.job.payload.model).toBeUndefined();
    expect(f.authority.dispose).toHaveBeenCalledOnce();
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.cron.updateWithPrecondition).toHaveBeenCalledOnce();
  });

  it.each(['auto', 'user'])('reauthorizes only the exact prior enterprise binding and retains its %s source', async (source) => {
    const f = await fixture();
    await f.continuity(source);
    expect(await f.run()).toEqual({ migrated: 1, skipped: 0 });
    expect(f.job.inferenceBinding).toEqual({ ...f.binding, source });
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
  });

  it('accepts only the ownerless historical agent proven by the host manifest', async () => {
    const f = await fixture('secondary');
    delete f.entry.definition.agentId;
    f.entry.agentId = 'secondary';
    await f.save();
    expect(await f.run()).toEqual({ migrated: 1, skipped: 0 });
    const other = await fixture('secondary');
    delete other.entry.definition.agentId;
    other.entry.agentId = 'main';
    await other.save();
    expect(await other.run()).toEqual({ migrated: 0, skipped: 1 });
  });

  it.each(['before capture', 'at commit'])('rejects an ambient owner change %s for an ownerless task', async (when) => {
    const f = await fixture('secondary');
    delete f.job.agentId; delete f.entry.definition.agentId; f.entry.agentId = 'secondary';
    await f.save();
    if (when === 'before capture') f.cfg.owner = 'main';
    else f.beforeCommit.fn = () => { f.cfg.owner = 'main'; };
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.job.inferenceBinding).toBeUndefined();
    if (when === 'before capture') expect(f.adapters.capture).not.toHaveBeenCalled();
  });

  it.each(['modelOverride', 'providerOverride', 'modelSelectionLocked', 'authProfileOverride'])('rejects a current session %s before capture and at commit', async (field) => {
    for (const when of ['before capture', 'at commit']) {
      const f = await fixture();
      const change = () => { f.session[field] = field === 'modelSelectionLocked' ? true : 'other'; };
      if (when === 'before capture') change(); else f.beforeCommit.fn = change;
      expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
      expect(f.job.inferenceBinding).toBeUndefined();
      if (when === 'before capture') expect(f.adapters.capture).not.toHaveBeenCalled();
    }
  });

  it('accepts only the proven automatic session account or the exact prior binding account', async () => {
    const legacy = await fixture();
    legacy.session.authProfileOverride = legacy.entry.profileId;
    legacy.session.authProfileOverrideSource = 'auto';
    expect(await legacy.run()).toEqual({ migrated: 1, skipped: 0 });
    const changed = await fixture();
    changed.session.authProfileOverride = changed.entry.profileId;
    changed.session.authProfileOverrideSource = 'user';
    expect(await changed.run()).toEqual({ migrated: 0, skipped: 1 });
    const continuity = await fixture(); await continuity.continuity();
    continuity.session.authProfileOverride = continuity.entry.profileId;
    continuity.session.authProfileOverrideSource = 'user';
    expect(await continuity.run()).toEqual({ migrated: 1, skipped: 0 });
  });

  it.each([undefined, '   '])('does not infer a default account for a configured Gmail hook model (payload %s)', async (model) => {
    const f = await fixture();
    if (model !== undefined) f.job.payload.model = f.entry.definition.payload.model = model;
    f.job.payload.externalContentSource = f.entry.definition.payload.externalContentSource = 'gmail';
    f.cfg.hooks = { gmail: { model: 'custom-enterpri/other@another:account' } };
    await f.save();
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.adapters.capture).not.toHaveBeenCalled();
    expect(f.log.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'execution-context' }), expect.any(String));
  });

  it.each([
    ['existing binding', (f: Awaited<ReturnType<typeof fixture>>) => { f.job.inferenceBinding = { authorizationId: 'existing' }; }],
    ['runtime authority', (f: Awaited<ReturnType<typeof fixture>>) => { f.job.runtimeAuthority = {}; }],
    ['system declaration', (f: Awaited<ReturnType<typeof fixture>>) => { f.job.declarationKey = 'memory-core:owned'; }],
    ['changed task', (f: Awaited<ReturnType<typeof fixture>>) => { f.job.payload.message = 'Different task'; }],
    ['changed provider', (f: Awaited<ReturnType<typeof fixture>>) => { f.cfg.model = 'different/model'; }],
    ['replaced credential', (f: Awaited<ReturnType<typeof fixture>>) => { f.credential.key = 'replacement'; }],
  ])('preserves checks for %s and emits a controlled diagnostic', async (_name, change) => {
    const f = await fixture(); change(f);
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.cron.updateWithPrecondition).not.toHaveBeenCalled();
    expect(f.adapters.capture).not.toHaveBeenCalled();
    expect(f.log.warn).toHaveBeenCalledWith(expect.objectContaining({ jobId: f.job.id, reason: expect.any(String) }), expect.any(String));
    expect(JSON.stringify(f.log.warn.mock.calls)).not.toContain(f.credential.key);
  });

  it('rejects duplicate evidence, personal accounts and forged prior binding evidence', async () => {
    const f = await fixture();
    await f.save([f.entry, f.entry]);
    expect(await f.run()).toEqual({ migrated: 0, skipped: 2 });
    await f.continuity();
    f.entry.expectedPreviousBinding = { ...f.entry.expectedPreviousBinding, authorizationId: 'forged' };
    await f.save();
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    f.entry.profileId = 'user:private'; await f.save();
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.adapters.capture).not.toHaveBeenCalled();
  });

  it.each(['definition', 'binding', 'provider', 'revocation'])('rejects concurrent %s changes and disposes native authority', async (kind) => {
    const f = await fixture(); await f.continuity();
    f.beforeCommit.fn = () => {
      if (kind === 'definition') f.job.updatedAtMs++;
      if (kind === 'binding') f.job.inferenceBinding = { ...f.binding, authorizationId: 'c'.repeat(64) };
      if (kind === 'provider') f.cfg.model = 'different/model';
      if (kind === 'revocation') f.authority.assertCurrent.mockImplementation(() => { throw new Error('revoked'); });
    };
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.job.inferenceBinding).not.toEqual(f.binding);
    expect(f.authority.dispose).toHaveBeenCalledOnce();
  });

  it('checks credential identity again after capture', async () => {
    const f = await fixture();
    f.adapters.capture.mockImplementation(async (args: Json) => {
      args.retainAuthorization(f.authority); f.credential.key = 'replaced-during-capture'; return f.binding;
    });
    expect(await f.run()).toEqual({ migrated: 0, skipped: 1 });
    expect(f.cron.updateWithPrecondition).not.toHaveBeenCalled();
    expect(f.authority.dispose).toHaveBeenCalledOnce();
  });

  it('allows added migration metadata while preserving existing policies', async () => {
    const f = await fixture(); f.job.scheduledToolPolicy = { mode: 'restricted' };
    expect(runtime.sameLegacyCronDefinition(f.job, f.entry.definition)).toBe(true);
    f.entry.definition.scheduledToolPolicy = { mode: 'account' };
    expect(runtime.sameLegacyCronDefinition(f.job, f.entry.definition)).toBe(false);
    expect(runtime.stableCredentialDigest({ a: 1, b: 2 })).toBe(runtime.stableCredentialDigest({ b: 2, a: 1 }));
  });

  it('runs the installed startup hook inside scheduler ownership before dispatch and respects stop', async () => {
    const source = await readFile(path.join(runtimeDir, 'service-pOwE_Xvo.mjs'), 'utf8');
    const begin = source.indexOf('\tasync startOnce(generation) {');
    const method = source.slice(begin, source.indexOf('\n\tstop() {', begin));
    const calls: string[] = [];
    const facade = runInNewContext(`({ ${method} })`, { start: async () => { calls.push('dispatch'); }, stop: () => { calls.push('stop'); } });
    const state = { lifecycleGeneration: 1, stopped: false, schedulerStarted: false, deps: {
      beforeStart: async () => { calls.push('migrate'); },
      runSchedulerOwned: async (fn: () => Promise<void>) => { calls.push('owned'); await fn(); },
    } };
    const context = { state, startInProgress: 0 };
    await facade.startOnce.call(context, 1);
    expect(calls).toEqual(['owned', 'migrate', 'dispatch']);
    calls.length = 0;
    state.deps.beforeStart = async () => { calls.push('migrate'); state.lifecycleGeneration++; };
    await facade.startOnce.call(context, 1);
    expect(calls).toEqual(['owned', 'migrate', 'stop']);
    expect(context.startInProgress).toBe(0);
  });
});

function selectionFixture() {
  const cfg: Json = { agents: { defaults: {
    model: { primary: 'custom-enterpri/current', fallbacks: ['other/foreign', 'custom-enterpri/backup'] },
    modelPolicy: { allow: ['custom-enterpri/current', 'custom-enterpri/backup', 'other/foreign'] },
  }, list: [{ id: 'main' }] }, models: { providers: { 'custom-enterpri': {
    api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', models: [{ id: 'current' }, { id: 'backup' }],
  } } } };
  const owner = { agentId: 'main', config: cfg, metadataSnapshot: [], modelCatalog: { entries: [
    { provider: 'custom-enterpri', id: 'current', name: 'current' },
    { provider: 'custom-enterpri', id: 'backup', name: 'backup' },
    { provider: 'other', id: 'foreign', name: 'foreign' },
  ] } };
  const params: Json = { cfg, owner, agentId: 'main', sessionEntry: {},
    payload: { kind: 'agentTurn', model: 'custom-enterpri/removed', message: 'Drink water' },
    inferenceBinding: { provider: 'custom-enterpri', profileId: 'custom-enterpri:default' },
  };
  const { t: select } = requireRuntime(path.join(runtimeDir, 'model-selection-bKuk9voj.mjs'));
  return { cfg, owner, params, run: () => select(params) };
}

describe('native cron model selection after remote catalog updates', () => {
  it('uses a same-account configured fallback when a saved model disappears', async () => {
    const f = selectionFixture(); const before = structuredClone(f.params.payload);
    expect(await f.run()).toMatchObject({ ok: true, provider: 'custom-enterpri', model: 'backup' });
    expect(f.params.payload).toEqual(before);
  });
  it('uses the current primary when no configured fallback survives', async () => {
    const f = selectionFixture(); f.cfg.agents.defaults.model.fallbacks = [];
    expect(await f.run()).toMatchObject({ ok: true, provider: 'custom-enterpri', model: 'current' });
  });
  it('retains the explicit account when a preferred model disappears', async () => {
    const f = selectionFixture(); f.params.payload.model += '@custom-enterpri:default';
    expect(await f.run()).toMatchObject({ ok: true, model: 'backup', configuredProfileId: 'custom-enterpri:default' });
  });
  it('keeps the configured ladder for endpoint failures and respects an explicit empty ladder', () => {
    const f = selectionFixture();
    const { n: fallbacks } = requireRuntime(path.join(runtimeDir, 'run-fallback-policy-wMomHJ3c.mjs'));
    const request = { cfg: f.cfg, agentId: 'main', job: { payload: f.params.payload } };
    expect(fallbacks(request)).toBeUndefined();
    f.params.payload.fallbacks = [];
    expect(fallbacks(request)).toEqual([]);
  });

  it('keeps a locked model when native endpoint preflight fails, even with authored fallbacks', async () => {
    const f = selectionFixture();
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing isolated test port');
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    f.cfg.models.providers['custom-enterpri'].baseUrl = `http://127.0.0.1:${address.port}`;
    f.params.payload.model = 'custom-enterpri/current';
    f.params.payload.fallbacks = ['other/foreign'];
    const { r: preflight } = requireRuntime(path.join(runtimeDir, 'run-fallback-policy-wMomHJ3c.mjs'));
    const request = { cfg: f.cfg, agentId: 'main', job: { id: 'locked-fixture', payload: f.params.payload }, provider: 'custom-enterpri', model: 'current' };
    // Exercise the installed provider TCP preflight and candidate resolver;
    // the other provider has no local endpoint and needs no network request.
    expect(await preflight(request)).toMatchObject({ ok: true, provider: 'other', model: 'foreign' });
    expect(await preflight({ ...request, modelSelectionLocked: true })).toMatchObject({ ok: false, reason: expect.stringContaining('custom-enterpri/current') });
    f.params.payload.fallbacks = [];
    expect(await preflight(request)).toMatchObject({ ok: false });
    const caller = await readFile(path.join(runtimeDir, 'isolated-agent-CPxLr234.mjs'), 'utf8');
    const preflightCall = caller.slice(caller.indexOf('const preflight = await resolveCronPreflight({'));
    expect(preflightCall.slice(0, preflightCall.indexOf('});'))).toContain('modelSelectionLocked: cronSession.sessionEntry.modelSelectionLocked');
  }, 10_000);
  it.each(['empty', 'locked', 'known-denied', 'other-provider', 'other-profile'])('keeps explicit refusal for %s', async (kind) => {
    const f = selectionFixture();
    if (kind === 'empty') f.params.payload.fallbacks = [];
    if (kind === 'locked') f.params.sessionEntry.modelSelectionLocked = true;
    if (kind === 'known-denied') f.owner.modelCatalog.entries.push({ provider: 'custom-enterpri', id: 'removed', name: 'denied' });
    if (kind === 'other-provider') f.params.inferenceBinding.provider = 'other';
    if (kind === 'other-profile') f.params.payload.model += '@different:profile';
    expect(await f.run()).toMatchObject({ ok: false });
  });
  it('reads refreshed defaults on every run without pinning task payload', async () => {
    const f = selectionFixture(); delete f.params.payload.model;
    expect(await f.run()).toMatchObject({ model: 'current' });
    f.cfg.agents.defaults.model.primary = 'custom-enterpri/backup';
    expect(await f.run()).toMatchObject({ model: 'backup' });
    expect(f.params.payload.model).toBeUndefined();
  });
});
