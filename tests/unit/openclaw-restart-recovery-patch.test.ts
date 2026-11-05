// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');
const execFileAsync = promisify(execFile);

const OPENCLAW_VERSION = '2026.10.5';
const PATCH_PATH = `patches/openclaw@${OPENCLAW_VERSION}.patch`;

async function loadBundledFunctions<T>(file: string, names: string[], context: Record<string, unknown>) {
  const bundle = (await readFile(path.join(dist, file), 'utf8')).replace(/\r\n/g, '\n');
  const declarations = names.map((name) => {
    const matches = [...bundle.matchAll(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))];
    expect(matches, `${file}: ${name}`).toHaveLength(1);
    return matches[0][0];
  });
  return runInNewContext(`${declarations.join('\n')}\n({ ${names.join(', ')} });`, context) as T;
}

describe('OpenClaw restart recovery contract', () => {
  it('retires empty Windows brokers without a Unix census while retaining tracked cleanup and Unix uncertainty', async () => {
    const cases = [
      { platform: 'win32', retained: 'none', group: undefined, immediate: true },
      { platform: 'win32', retained: 'owned', group: false, immediate: false },
      { platform: 'win32', retained: 'starting', group: false, immediate: false },
      { platform: 'win32', retained: 'resources', group: false, immediate: false },
      { platform: 'linux', retained: 'none', group: undefined, immediate: false },
      { platform: 'linux', retained: 'none', group: true, immediate: false },
      { platform: 'linux', retained: 'none', group: false, immediate: true },
    ];
    for (const scenario of cases) {
      const label = JSON.stringify(scenario);
      const child = { pid: 456, connected: true, disconnect: vi.fn() };
      const exit = vi.fn();
      const kill = vi.fn(() => {
        if (scenario.platform === 'win32') throw new Error('Unix process groups are unavailable');
      });
      const force = vi.fn();
      const killProcessTree = vi.fn(() => ({ force }));
      const census = vi.fn(() => scenario.group);
      const timers: Array<() => void> = [];
      const schedule = vi.fn((callback: () => void, _delay: number) => { timers.push(callback); });
      const resolveGrant = vi.fn();
      const clearReceiver = vi.fn();
      const { shutdown } = await loadBundledFunctions<{ shutdown: () => void }>(
        'process/spawn-broker/worker.js', ['shutdown'], {
          process: { platform: scenario.platform, pid: 123, kill, exit },
          stopping: false,
          owned: new Map(scenario.retained === 'owned' ? [[1, { child, detached: false }]] : []),
          starting: new Map(scenario.retained === 'starting' ? [[1, {}]] : []),
          launchGrants: new Map([[1, { resolve: resolveGrant }]]),
          resources: { size: scenario.retained === 'resources' ? 1 : 0, disconnect: vi.fn() },
          sender: { close: vi.fn() }, receiver: { clear: clearReceiver },
          GRACEFUL_CANCEL_TIMEOUT_MS: 5_000,
          killProcessTree, hasLiveOwnedProcessGroupMembers: census, setTimeout: schedule,
        },
      );
      shutdown();
      shutdown();
      expect(resolveGrant, label).toHaveBeenCalledExactlyOnceWith(false);
      expect(clearReceiver, label).toHaveBeenCalledOnce();
      if (scenario.platform === 'win32') expect(census, label).not.toHaveBeenCalled();
      if (scenario.immediate) expect(schedule, label).not.toHaveBeenCalled();
      else {
        expect(exit, label).not.toHaveBeenCalled();
        expect(schedule, label).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 5_250);
        timers[0]();
      }
      expect(exit, label).toHaveBeenCalledExactlyOnceWith(0);
      expect(kill, label).toHaveBeenCalledWith(-123, 'SIGKILL');
      if (scenario.retained === 'owned') {
        expect(child.disconnect, label).toHaveBeenCalledOnce();
        expect(killProcessTree, label).toHaveBeenCalledExactlyOnceWith(456, { detached: false, graceMs: 5_000 });
        expect(force, label).toHaveBeenCalledOnce();
      } else expect(killProcessTree, label).not.toHaveBeenCalled();
    }
  });

  it('skips dead-owner birth probes without losing PID reuse, unknown-owner, or exit-race checks', async () => {
    type Inspect = (params: {
      payload: { pid: number; starttime?: number };
      getProcessStartTime: (pid: number) => number | null;
      isPidDefinitelyDead: (pid: number) => boolean;
    }) => { reason: string; observedStarttime: number | null } | null;
    const files = [
      'stale-lock-file-BXwDVcTj.mjs',
      'infra/sqlite-readonly-location.worker.js',
      'state/openclaw-state-read.worker.js',
      'state/openclaw-state-lease-heartbeat.worker.js',
      'managed-handoff-runtime.mjs',
      'package-update-activation-recovery.mjs',
      'process/supervisor/service-child-group-anchor.js',
      'native-hook-relay/sqlite-snapshot-staging-owner-Coa4BeBx.mjs',
    ];
    for (const file of files) {
      const { inspectStaleLockOwner: inspect } = await loadBundledFunctions<{ inspectStaleLockOwner: Inspect }>(
        file, ['readLockFileOwnerPayload', 'inspectStaleLockOwner'], { process: { platform: 'win32' } },
      );
      const payload = { pid: 12345, starttime: 100 };
      const birth = vi.fn((): number | null => 100);
      expect(inspect({ payload, getProcessStartTime: birth, isPidDefinitelyDead: () => true }), file)
        .toMatchObject({ reason: 'owner-process-exited', observedStarttime: null });
      expect(birth, file).not.toHaveBeenCalled();
      expect(inspect({ payload, getProcessStartTime: birth, isPidDefinitelyDead: () => false }), file).toBeNull();
      expect(inspect({ payload, getProcessStartTime: () => 101, isPidDefinitelyDead: () => false }), file)
        .toMatchObject({ reason: 'owner-starttime-changed', observedStarttime: 101 });
      // Permission failures map to "not definitely dead"; unavailable identity
      // must never be interpreted as permission to reclaim a live/unknown owner.
      expect(inspect({ payload, getProcessStartTime: () => null, isPidDefinitelyDead: () => false }), file).toBeNull();
      let exited = false;
      expect(inspect({
        payload,
        getProcessStartTime: () => { exited = true; return null; },
        isPidDefinitelyDead: () => exited,
      }), file).toMatchObject({ reason: 'owner-process-exited' });
      birth.mockClear();
      expect(inspect({ payload: { pid: payload.pid }, getProcessStartTime: birth, isPidDefinitelyDead: () => false }), file).toBeNull();
      expect(birth, file).not.toHaveBeenCalled();
    }
  });

  it('combines only safe machine webhook decisions while keeping explicit config authoritative', async () => {
    const channels = ['telegram', 'feishu', 'msteams', 'nextcloud-talk'];
    const complete = Object.fromEntries(channels.map((id) => [id, []]));
    const partial = { telegram: [], feishu: [], 'nextcloud-talk': [] };
    const readMachine = vi.fn<() => unknown>(() => complete);
    const ambientEnv: Record<string, string> = {};
    const { readHistoricalWebhookCompletion: read, shouldRunHistoricalWebhookMigration: shouldRun } = await loadBundledFunctions<{
      readHistoricalWebhookCompletion: (config: Record<string, unknown>, env: object) => unknown;
      shouldRunHistoricalWebhookMigration: (config: Record<string, unknown>, env: object) => boolean;
    }>('legacy-webhook-pins-Bucp571j.mjs', ['webhookCompletionKey', 'readHistoricalWebhookCompletion', 'shouldRunHistoricalWebhookMigration'], {
      HISTORICAL_WEBHOOK_CHANNELS: channels,
      process: { env: ambientEnv },
      resolveConfigPath: () => '/fixture/openclaw.json',
      readConfigMachineState: readMachine,
      asNullableRecord: (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value : null,
    });
    const config = (marker: unknown, configuredChannels: object = {}) => ({
      channels: configuredChannels, meta: { migrations: { webhookListeners: marker } },
    });
    expect(read(config(partial), {})).toEqual(complete);
    expect(shouldRun(config(partial), {})).toBe(false);
    expect(read(config(partial, { msteams: { enabled: true } }), {})).toBe(partial);
    expect(read(config(partial, { msteams: { enabled: false } }), {})).toBe(partial);
    expect(read(config(partial), { MSTEAMS_APP_ID: '' })).toBe(partial);
    expect(shouldRun(config(partial), { MSTEAMS_APP_ID: 'fixture' })).toBe(true);
    ambientEnv.MSTEAMS_APP_PASSWORD = 'fixture';
    expect(read(config(partial), {})).toBe(partial);
    expect(shouldRun(config(partial), {})).toBe(true);
    delete ambientEnv.MSTEAMS_APP_PASSWORD;
    // A completed webhook item does not imply its other compatibility fields
    // are current; the original startup normalizer must still inspect them.
    expect(shouldRun(config(partial, { telegram: { includeGroupHistoryContext: 'none' } }), {})).toBe(true);
    const legacyPlugin = {
      ...config({ telegram: [], msteams: [], 'nextcloud-talk': [] }),
      plugins: { entries: { feishu: { config: { enabled: true } } } },
    };
    expect(read(legacyPlugin, {})).toBe(legacyPlugin.meta.migrations.webhookListeners);
    expect(shouldRun(legacyPlugin, {})).toBe(true);
    const authored = { msteams: [['channels', 'msteams', 'legacyWebhook']] };
    expect(read(config(authored), {})).toEqual({ ...complete, ...authored });
    readMachine.mockReturnValue({ msteams: [['channels', 'msteams', 'legacyWebhook']] });
    expect(read(config(partial), {})).toBe(partial);
    readMachine.mockReturnValue(true);
    expect(read(config(partial), {})).toBe(partial);
    expect(read(config(undefined), {})).toBe(true);
    readMachine.mockClear();
    expect(read(config(true), {})).toBe(true);
    expect(read(config(complete), {})).toBe(complete);
    expect(shouldRun(config(true), {})).toBe(false);
    expect(shouldRun(config(complete), {})).toBe(false);
    expect(shouldRun(config(undefined), {})).toBe(true);
    expect(shouldRun(config(null), {})).toBe(true);
    expect(readMachine).not.toHaveBeenCalled();
    readMachine.mockImplementation(() => { throw new Error('machine state unavailable'); });
    expect(read(config(partial), {})).toBe(partial);
    expect(() => read(config(undefined), {})).toThrow('machine state unavailable');
  });

  it('reuses completed webhook work without hiding restored callbacks or bypassing marker-only publication', async () => {
    type Config = {
      channels: Record<string, Record<string, unknown>>;
      meta: { migrations: { webhookListeners: Record<string, string[][]> } };
    };
    type Mutation = { config: Config; changes: string[]; historicalWebhookAccountIds: undefined[] };
    const channels = ['telegram', 'feishu', 'msteams', 'nextcloud-talk'];
    const complete = Object.fromEntries(channels.map((id) => [id, []]));
    const writeMachine = vi.fn();
    const functions = await loadBundledFunctions<{
      applyHistoricalWebhookPins: (mutation: Mutation, declaration: object, context: object) => Mutation;
      recordUnwrittenWebhookCompletion: (snapshot: { sourceConfig: Config }, mutation: Mutation, env: object) => boolean;
    }>('legacy-webhook-pins-Bucp571j.mjs', [
      'webhookCompletionKey', 'readHistoricalWebhookCompletion',
      'recordUnwrittenWebhookCompletion', 'applyHistoricalWebhookPins',
    ], {
      HISTORICAL_WEBHOOK_CHANNELS: channels,
      process: { env: {} },
      resolveConfigPath: () => '/fixture/openclaw.json',
      readConfigMachineState: () => complete,
      writeConfigMachineState: writeMachine,
      asNullableRecord: (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value : null,
      resolveIsConfigReadOnly: () => false,
      cloneConfigWithResolutionFacts: structuredClone,
      isDeepStrictEqual,
      resolveUpdateRehearsalRoot: () => undefined,
      getConfigValueAtPath: (value: Record<string, unknown>, fields: string[]) => fields.reduce<unknown>(
        (current, field) => (current as Record<string, unknown> | undefined)?.[field], value,
      ),
      setConfigValueAtPath: (value: Record<string, unknown>, fields: string[], item: unknown) => {
        let current = value;
        for (const field of fields.slice(0, -1)) current = (current[field] ??= {}) as Record<string, unknown>;
        current[fields.at(-1)!] = item;
      },
    });
    const config: Config = { channels: {}, meta: { migrations: { webhookListeners: {
      telegram: [], feishu: [], 'nextcloud-talk': [],
    } } } };
    const mutation: Mutation = { config, changes: [], historicalWebhookAccountIds: [undefined] };
    const declaration = { channelId: 'msteams', path: '/api/messages', port: 3978 };
    const context = { env: {}, startup: true };
    expect(functions.applyHistoricalWebhookPins(mutation, declaration, context)).toBe(mutation);
    const envRestored = functions.applyHistoricalWebhookPins(mutation, declaration, {
      env: { MSTEAMS_APP_ID: 'fixture' }, startup: true,
    });
    expect(envRestored.config.channels.msteams.legacyWebhook).toEqual({ path: '/api/messages', port: 3978 });
    const restored = { ...mutation, config: { ...config, channels: { msteams: {} } } };
    const migrated = functions.applyHistoricalWebhookPins(restored, declaration, context);
    expect(migrated.config.channels.msteams.legacyWebhook).toEqual({ path: '/api/messages', port: 3978 });
    expect(restored.config.channels.msteams).toEqual({});
    expect(functions.recordUnwrittenWebhookCompletion({ sourceConfig: restored.config }, migrated, {})).toBe(false);
    expect(writeMachine).not.toHaveBeenCalled();
    const authoredCallback = { path: '/authored-callback', port: 5000 };
    const authored = { ...mutation, config: { ...config, channels: { msteams: { legacyWebhook: authoredCallback } } } };
    expect(functions.applyHistoricalWebhookPins(authored, declaration, context).config.channels.msteams.legacyWebhook)
      .toEqual(authoredCallback);
    const markerOnly = { ...mutation, config: { ...config, meta: { migrations: { webhookListeners: complete } } } };
    expect(functions.recordUnwrittenWebhookCompletion({ sourceConfig: config }, markerOnly, {})).toBe(true);
    expect(writeMachine).toHaveBeenCalledWith('webhookListeners:/fixture/openclaw.json', complete, { env: {} });
  });

  it('registers the pinned 2026.10.5 runtime patch through the pnpm workspace', async () => {
    const workspace = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    const patch = await readFile(path.join(root, PATCH_PATH));
    const patchHash = createHash('sha256').update(patch).digest('hex');

    expect(workspace).toContain(`openclaw@${OPENCLAW_VERSION}: ${PATCH_PATH}`);
    expect(lockfile).toContain(`path: ${PATCH_PATH}`);
    expect(lockfile).toContain(`hash: ${patchHash}`);
  });

  it('relies on the upstream 2026.10.5 restart-recovery lineage and admission path', async () => {
    // Upstream 2026.10.5 ships the recovery work ClawX previously backported:
    // startup orphan marking, interrupted-run lineage, and recovery admission
    // provenance. The ClawX patch must not duplicate it.
    const [preflight, lifecycle, marking] = await Promise.all([
      readFile(path.join(dist, 'agent-request-preflight-f94DZoO_.mjs'), 'utf8'),
      readFile(path.join(dist, 'main-session-restart-recovery-Xw9O4XVI.mjs'), 'utf8'),
      readFile(path.join(dist, 'main-session-restart-recovery-marking-zFjz6Dha.mjs'), 'utf8'),
    ]);

    expect(preflight).toContain('isMainSessionRestartRecoveryInputProvenance');
    expect(preflight).toContain('internal execution identity recovery fields are reserved for main-session restart recovery');
    expect(lifecycle).toContain('restartRecoveryDeliverySourceRunId = sourceRunId');
    expect(lifecycle).toContain('function readInterruptedRunId');
    expect(lifecycle).toContain('internalExecutionIdentityRecoveryAttempt');
    expect(lifecycle).toContain('sourceTool: MAIN_SESSION_RESTART_RECOVERY_SOURCE_TOOL');
    expect(marking).toContain('async function markStartupOrphanedMainSessionsForRecovery');
    expect(marking).toContain('entry.lifecycleRunId');

    const patch = await readFile(path.join(root, PATCH_PATH), 'utf8');
    expect(patch).not.toContain('internalRestartRecoverySourceRunId');
    expect(patch).not.toContain('resolvePersistedAgentWaitSnapshot');
  });

  it('executes the ClawX transcript fallback as ordered native ACP replay updates', async () => {
    const bundle = await readFile(path.join(dist, 'server-DkfYuk25.mjs'), 'utf8');
    const replayStart = bundle.indexOf('function extractToolResultReplay(message)');
    const end = bundle.indexOf('//#endregion', replayStart);
    expect(replayStart).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(replayStart);

    const context = {
      normalizeOptionalString: (value: unknown) => (
        typeof value === 'string' && value.trim() ? value.trim() : undefined
      ),
      asOptionalRecord: (value: unknown) => (
        value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : undefined
      ),
      formatToolTitle: (name: string | undefined) => name ?? 'tool',
      inferToolKind: () => 'other',
      extractToolCallLocations: () => undefined,
      extractToolCallContent: (value: unknown) => (
        typeof value === 'string'
          ? [{ type: 'content', content: { type: 'text', text: value } }]
          : undefined
      ),
      timestampMsToIsoString: () => undefined,
      extractReplayChunks: undefined as ((message: Record<string, unknown>) => unknown[]) | undefined,
    };
    runInNewContext(
      `${bundle.slice(replayStart, end)}\nglobalThis.extractReplayChunks = extractReplayChunks;`,
      context,
    );
    const extractReplayChunks = context.extractReplayChunks;
    expect(extractReplayChunks).toBeTypeOf('function');

    expect(extractReplayChunks?.({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Before tool' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/app.ts' } },
        { type: 'text', text: 'After tool' },
      ],
    })).toEqual([
      { sessionUpdate: 'agent_message_chunk', text: 'Before tool' },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'read',
        status: 'in_progress',
        rawInput: { path: 'src/app.ts' },
        kind: 'other',
        locations: undefined,
      },
      { sessionUpdate: 'agent_message_chunk', text: 'After tool' },
    ]);

    expect(extractReplayChunks?.({
      role: 'toolResult',
      toolCallId: 'call-1',
      content: 'plain tool output',
    })).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        rawOutput: { content: 'plain tool output' },
        content: [{ type: 'content', content: { type: 'text', text: 'plain tool output' } }],
        locations: undefined,
      },
    ]);

    expect(extractReplayChunks?.({
      role: 'assistant',
      timestamp: 1_700_000_000_000,
      __openclaw: { kind: 'compaction', id: 'cmp-replay' },
      content: [],
    })).toEqual([
      {
        sessionUpdate: 'session_info_update',
        _meta: {
          'openclaw.ai/compaction': {
            version: 1,
            compactionId: 'cmp-replay',
            status: 'completed',
            source: 'transcript',
          },
        },
      },
    ]);
  });

  it('uses native admitted routing for live and completed recovery wait targets', async () => {
    const fixtureParent = await realpath(tmpdir());
    const fixturePrefix = 'clawx-restart-recovery-';
    const fixtureRoot = await mkdtemp(path.join(fixtureParent, fixturePrefix));
    const cleanupFixture = async () => {
      const resolvedFixture = await realpath(fixtureRoot);
      if (path.dirname(resolvedFixture) !== fixtureParent || !path.basename(resolvedFixture).startsWith(fixturePrefix)) {
        throw new Error('Refusing to remove a fixture outside its temporary parent');
      }
      await rm(resolvedFixture, { recursive: true, force: true });
    };
    try {
      const fixtureHome = path.join(fixtureRoot, 'home');
      const fixtureState = path.join(fixtureHome, '.openclaw');
      const fixtureWorkspace = path.join(fixtureRoot, 'workspace');
      const fixtureRoaming = path.join(fixtureRoot, 'roaming');
      const fixtureLocal = path.join(fixtureRoot, 'local');
      await Promise.all([fixtureState, fixtureWorkspace, fixtureRoaming, fixtureLocal].map(
        (directory) => mkdir(directory, { recursive: true }),
      ));
      const env = {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENCLAW_|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$)/i.test(key))),
        HOME: fixtureHome,
        USERPROFILE: fixtureHome,
        APPDATA: fixtureRoaming,
        LOCALAPPDATA: fixtureLocal,
        OPENCLAW_HOME: fixtureHome,
        OPENCLAW_STATE_DIR: fixtureState,
        OPENCLAW_CONFIG_PATH: path.join(fixtureState, 'openclaw.json'),
      };
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
      import * as registry from './node_modules/openclaw/dist/agent-run-registry-zReSioYT.mjs';
      import * as events from './node_modules/openclaw/dist/agent-events-CCeMHYh0.mjs';
      import * as jobs from './node_modules/openclaw/dist/agent-job-DleplIFW.mjs';
      import { n as prepareWait } from './node_modules/openclaw/dist/session-request-targets-BAGtAj-T.mjs';
      const key = 'agent:main:restart-native-fixture';
      const generation = registry.f();
      await jobs.a({ runId: 'initialize-observer', timeoutMs: 0 });
      const owner = registry.i('recovered', { sessionKey: key, sessionId: 'session', lifecycleGeneration: generation, resumedFromRunId: 'original' }, { trackOwner: true, ownsContext: true });
      registry.i('unrelated', { sessionKey: key, sessionId: 'session', lifecycleGeneration: generation });
      const live = jobs.resolveAgentRecoveryWaitTarget('original', key);
      const wrongSession = jobs.resolveAgentRecoveryWaitTarget('original', 'agent:other:session');
      const seen = [];
      events.m(event => seen.push(event));
      events.a({ runId: 'unrelated', resumedFromRunId: 'forged', stream: 'lifecycle', data: { phase: 'start', startedAt: Date.now() } });
      events.a({ runId: 'recovered', stream: 'lifecycle', data: { phase: 'end', startedAt: Date.now() - 1, endedAt: Date.now(), status: 'ok', stopReason: 'stop', terminalReply: { disposition: 'empty' } } });
      registry.o('recovered');
      registry.C('recovered', owner);
      const completed = jobs.resolveAgentRecoveryWaitTarget('original', key);
      const wait = prepareWait({ chatAbortControllers: new Map(), chatQueuedTurns: new Map(), dedupe: new Map(), getRuntimeConfig: () => ({ agents: { defaults: { workspace: ${JSON.stringify(fixtureWorkspace)} } } }) }, { runId: 'original', sessionKey: key, timeoutMs: 0 });
      const observation = await wait.wait();
      console.log(JSON.stringify({ live, wrongSession, completed, forged: seen.find(e => e.runId === 'unrelated').resumedFromRunId ?? null, session: wait.session, result: observation.result }));
      `], { cwd: root, env, timeout: 20_000 });
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
      expect(result).toMatchObject({
        live: 'recovered', completed: 'recovered', wrongSession: 'original', forged: null,
        session: { sessionKey: 'agent:main:restart-native-fixture', sessionId: 'session' },
        result: { runId: 'recovered', resumedFromRunId: 'original', status: 'ok' },
      });
    } finally {
      await cleanupFixture();
    }
  });

  it('requires the exact durable terminal owner before using a post-restart receipt', async () => {
    const bundle = await readFile(path.join(dist, 'session-request-targets-BAGtAj-T.mjs'), 'utf8');
    const start = bundle.indexOf('function readAcpTerminalOwner(');
    const end = bundle.indexOf('function prepareAgentWaitForTurn(', start);
    let entry: Record<string, unknown> = { sessionId: 'native-session', lastRunId: 'finished-run', status: 'done', endedAt: 100 };
    const sandbox = {
      resolveSessionSharingTarget: () => ({ entry, storeKey: 'agent:main:fixture', agentId: 'main' }),
      getAgentEventLifecycleGeneration: () => 'current-generation',
      read: undefined as undefined | ((context: unknown, run: string, key: string) => unknown),
    };
    runInNewContext(`${bundle.slice(start, end)}\nglobalThis.read = readAcpTerminalOwner;`, sandbox);
    const context = { getRuntimeConfig: () => ({}) };
    expect(sandbox.read?.(context, 'finished-run', 'agent:main:fixture')).toMatchObject({
      status: 'ok', terminalReceipt: { runId: 'finished-run', sessionId: 'native-session' },
    });
    for (const patch of [
      { lastRunId: 'later-run' }, { lifecycleRunId: 'active-run' },
      { status: 'interrupted' }, { endedAt: Number.NaN },
    ]) {
      entry = { sessionId: 'native-session', lastRunId: 'finished-run', status: 'done', endedAt: 100, ...patch };
      expect(sandbox.read?.(context, 'finished-run', 'agent:main:fixture')).toBeUndefined();
    }
  });

  it('keeps every patched runtime chunk syntactically valid', async () => {
    const patch = await readFile(path.join(root, PATCH_PATH), 'utf8');
    const files = [...patch.matchAll(/^diff --git a\/(dist\/[^ ]+) b\//gm)].map((match) => match[1]);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      await expect(execFileAsync(process.execPath, [
        '--check',
        path.join(root, 'node_modules/openclaw', file),
      ])).resolves.toMatchObject({ stderr: '' });
    }
  });
});
