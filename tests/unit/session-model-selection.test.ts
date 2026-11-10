// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionsApi } from '@electron/services/sessions-api';

const key = 'agent:main:session-1';
const existing = { key, sessionId: 'session-id-1', modelProvider: 'openai', model: 'gpt-4.1' };

describe('session model selection', () => {
  it.each([
    ['user', 'openai/gpt-4.1'],
    ['auto', null],
    ['inherited', null],
    [null, null],
  ])('reads a %s selection without converting fallback or inherited models into user preferences', async (source, modelRef) => {
    const rpc = vi.fn().mockResolvedValue({ session: { ...existing, modelOverrideSource: source, contextTokens: 128_000 } });
    const api = createSessionsApi({ gatewayManager: { rpc } });
    await expect(api.getModel({ sessionKey: key })).resolves.toEqual({
      modelRef, effectiveModelRef: 'openai/gpt-4.1', contextWindow: 128_000,
    });
    expect(rpc).toHaveBeenCalledWith('sessions.describe', { key });
  });

  it('does not infer a preference from a historical model or create a missing row on read', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ session: existing }).mockResolvedValueOnce({ session: null });
    const api = createSessionsApi({ gatewayManager: { rpc } });
    await expect(api.getModel({ sessionKey: key })).resolves.toEqual({ modelRef: null });
    await expect(api.getModel({ sessionKey: key })).resolves.toEqual({ modelRef: null, exists: false });
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['sessions.describe', 'sessions.describe']);
  });

  it.each(['openai/gpt-4.1', null])('patches only the observed session identity for selection %s', async (modelRef) => {
    const rpc = vi.fn().mockResolvedValueOnce({ session: existing }).mockResolvedValueOnce({
      ok: true, key, entry: { modelOverrideSource: modelRef ? 'user' : 'default' },
      resolved: { modelProvider: 'openai', model: 'gpt-4.1', contextTokens: 128_000 },
    });
    const api = createSessionsApi({ gatewayManager: { rpc } });
    await expect(api.setModel({ sessionKey: key, modelRef })).resolves.toMatchObject({ modelRef, contextWindow: 128_000 });
    expect(rpc).toHaveBeenLastCalledWith('sessions.patch', { key, expectedSessionId: existing.sessionId, model: modelRef, modelScope: 'session' });
  });

  it('allows only an explicit first-send selection to materialize a missing Gateway row', async () => {
    const rpc = vi.fn().mockResolvedValue({ session: null });
    const api = createSessionsApi({ gatewayManager: { rpc } });
    await expect(api.setModel({ sessionKey: key, modelRef: 'openai/gpt-4.1' })).rejects.toThrow('no longer exists');
    await expect(api.setModel({ sessionKey: key, modelRef: null, createIfMissing: true })).rejects.toThrow('no longer exists');
    expect(rpc.mock.calls).toHaveLength(2);
    rpc.mockResolvedValueOnce({ session: null }).mockResolvedValueOnce({
      ok: true, key, entry: { modelOverrideSource: 'user' }, resolved: { modelProvider: 'openai', model: 'gpt-4.1' },
    });
    await api.setModel({ sessionKey: key, modelRef: 'openai/gpt-4.1', createIfMissing: true });
    expect(rpc).toHaveBeenLastCalledWith('sessions.patch', { key, model: 'openai/gpt-4.1', modelScope: 'session' });
  });

  it('propagates a scoped-write rejection without falling back to an unscoped write', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ session: existing }).mockRejectedValueOnce(new Error('unsupported modelScope'));
    const api = createSessionsApi({ gatewayManager: { rpc } });
    await expect(api.setModel({ sessionKey: key, modelRef: 'openai/gpt-4.1' })).rejects.toThrow('unsupported modelScope');
    expect(rpc.mock.calls).toHaveLength(2);
  });

});

describe('bundled OpenClaw session model selection', () => {
  let home: string;
  const runtime = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../../node_modules/openclaw/dist', file)).href;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'clawx-openclaw-session-model-'));
    vi.stubEnv('OPENCLAW_HOME', home);
    vi.stubEnv('OPENCLAW_STATE_DIR', home);
    vi.stubEnv('OPENCLAW_CONFIG_PATH', join(home, 'openclaw.json'));
  });
  afterEach(async () => {
    const { s: closeAgentDatabases } = await import(runtime('openclaw-agent-db-lifecycle-Cl48HKPu.mjs'));
    const { s: closeStateDatabase } = await import(runtime('openclaw-state-db-cache-SfxRpkii.mjs'));
    await closeAgentDatabases(home);
    await closeStateDatabase(join(home, 'state/openclaw.sqlite'));
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('recovers explicit version 0.6.1 overrides without promoting historical usage to a selection', async () => {
    const { P: buildSessionRow } = await import(runtime('session-row-prepared-read-BTwaWWsn.mjs'));
    const { n: buildReadIndex } = await import(runtime('subagent-registry-read-buyFwKXs.mjs'));
    const { n: buildContext } = await import(runtime('session-utils-projection-CsKOIaJd.mjs'));
    const now = Date.now();
    const rowContext = buildContext({ now, sessionKeys: [key], subagentRuns: buildReadIndex(now, [key], new Map()) });
    const history = { sessionId: existing.sessionId, updatedAt: now, modelProvider: 'openai', model: 'gpt-5' };
    const project = (entry: Record<string, unknown>) => buildSessionRow({
      cfg: { agents: { defaults: { workspace: home, model: { primary: 'openai/gpt-4.1' } } } },
      key, agentId: 'main', entry, store: { [key]: entry }, storePath: join(home, 'agents/main/sessions/sessions.json'),
      lightweightListRow: true, preparedAcpMeta: null, preparedModelMetadata: null, rowContext,
    });
    expect(project(history)).toMatchObject({ model: 'gpt-4.1', modelOverrideSource: null });
    expect(project({ ...history, modelOverride: 'gpt-5', providerOverride: 'openai' })).toMatchObject({
      model: 'gpt-5', modelProvider: 'openai', modelOverrideSource: 'user',
    });
  }, 30_000);

  it('keeps an explicit choice equal to the Agent default pinned and suppresses sticky Gateway configuration writes', async () => {
    const { Ta: validatePatch } = await import(runtime('src-SkiwT5zi.mjs'));
    const { n: projectPatch } = await import(runtime('sessions-patch-5NnOA6iw.mjs'));
    const { t: persistConfiguredModel } = await import(runtime('sessions-patch-model-selection-DG4p4dpp.mjs'));
    const cfg = { agents: { defaults: { model: { primary: 'openai/gpt-4.1' }, modelSelectionScope: 'global' } } };
    const patch = { key, model: 'openai/gpt-4.1', modelScope: 'session' };
    expect(validatePatch(patch)).toBe(true);
    expect(validatePatch({ ...patch, modelScope: 'global' })).toBe(false);
    const catalog = [{ id: 'gpt-4.1', name: 'Test', provider: 'openai', contextWindow: 128_000 }];
    const params = {
      cfg, patch, storeKey: key, agentId: 'main', loadGatewayModelCatalogSnapshot: async () => ({ entries: catalog }),
    };
    const pinned = await projectPatch(params);
    expect(pinned).toMatchObject({ ok: true, entry: { modelOverride: 'gpt-4.1', providerOverride: 'openai', modelOverrideSource: 'user' } });
    const { n: projectReceipt } = await import(runtime('session-utils-model-h78SGs03.mjs'));
    const receipt = projectReceipt({
      cfg, canonicalKey: key, targetAgentId: 'main', storePath: join(home, 'agents/main/sessions/sessions.json'),
      entry: pinned.entry, modelCatalog: catalog, preparedAcpMeta: null,
    });
    expect(receipt).toMatchObject({
      ok: true, key, entry: { sessionId: expect.any(String), modelOverrideSource: 'user' },
      resolved: { modelProvider: 'openai', model: 'gpt-4.1', contextTokens: 128_000 },
    });
    // A wider sticky scope would resolve a target agent and persist a config change.
    const readWriteTarget = vi.fn(() => key);
    persistConfiguredModel({ cfg, patch, callerScopes: ['operator.admin'], entry: pinned.entry, get sessionKey() { return readWriteTarget(); } });
    expect(readWriteTarget).not.toHaveBeenCalled();
    const cleared = await projectPatch({ ...params, existingEntry: pinned.entry, patch: { ...patch, model: null } });
    expect(cleared).toMatchObject({ ok: true, entry: { modelOverrideSource: 'default' } });
    expect(cleared.entry.modelOverride).toBeUndefined();
  }, 30_000);
});
