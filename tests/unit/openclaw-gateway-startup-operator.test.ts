// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const policy = 'startup-unavailable-D0-EeFjq.mjs';
const messages = 'message-handler-DSPg7e4A.mjs';

function declaration(file: string, name: string) {
  const source = readFileSync(path.join(dist, file), 'utf8');
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  if (!match) throw new Error('Missing installed OpenClaw function ' + name);
  return match[0];
}

function compiled(file: string, name: string, dependencies: Record<string, unknown> = {}) {
  return runInNewContext('(' + declaration(file, name) + ')', dependencies);
}

const desktop = {
  role: 'operator',
  client: { id: 'gateway-client', mode: 'ui', displayName: 'ClawX' },
  scopes: ['operator.admin'],
  auth: { token: 'test-token' },
  device: { id: 'test-device' },
};

describe('OpenClaw returning desktop startup admission', () => {
  it('requires the local desktop frame and keeps alternate credentials, roles and clients on normal admission', () => {
    const accepts = compiled(policy, 'isClawXStartupOperatorFrame');
    expect(accepts(desktop, true)).toBe(true);
    expect(accepts(desktop, false)).toBe(false);
    for (const changes of [
      { role: 'node' }, { device: undefined }, { scopes: [] },
      { client: { ...desktop.client, id: 'openclaw-control-ui' } },
      { client: { ...desktop.client, mode: 'backend' } },
      { auth: { token: '' } }, { auth: { token: 'a', bootstrapToken: 'b' } },
      { auth: { deviceToken: 'device-token' } },
    ]) expect(accepts({ ...desktop, ...changes }, true)).toBe(false);
  });

  it('opens only core session reads after plugin attachment, recovery and current agent admission', async () => {
    let dispatchReady = false;
    let pending = true;
    let agentDataReady = false;
    let closing = false;
    const admission = compiled(policy, 'createClawXStartupOperatorAdmission')({
      dispatchReady: () => dispatchReady,
      isPending: () => pending,
      isClosing: () => closing,
      agentDataReady: () => agentDataReady,
    });
    const coreReads = ['chat.history', 'sessions.list'].map(name => ({
      name, owner: { kind: 'core' }, scope: 'operator.read', controlPlaneWrite: false,
    }));
    const registry = { descriptors: () => coreReads };
    expect(admission.canConnect()).toBe(false);
    dispatchReady = true;
    expect(admission.canConnect()).toBe(true);
    expect(admission.unavailable('chat.history', registry)).toBe(true);
    admission.markSessionReadsReady();
    expect(admission.unavailable('sessions.list', registry)).toBe(true);
    agentDataReady = true;
    for (const { name } of coreReads) expect(admission.unavailable(name, registry)).toBe(false);
    for (const method of ['sessions.reset', 'chat.send', 'plugins.reload', 'custom.write', 'models.list']) {
      expect(admission.unavailable(method, registry)).toBe(true);
    }
    for (const changes of [{ owner: { kind: 'plugin' } }, { scope: 'operator.write' }, { controlPlaneWrite: true }]) {
      expect(admission.unavailable('chat.history', { descriptors: () => [{ ...coreReads[0], ...changes }] })).toBe(true);
    }
    agentDataReady = false;
    expect(admission.unavailable('chat.history', registry)).toBe(true);
    const ready = vi.fn();
    void admission.ready.then(ready);
    admission.updateReady();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    pending = false;
    admission.updateReady();
    await admission.ready;
    expect(ready).toHaveBeenCalledOnce();
    expect(admission.unavailable('chat.send', registry)).toBeUndefined();
    closing = true;
    expect(admission.canConnect()).toBe(false);
    expect(admission.unavailable('chat.history', registry)).toBe(true);
  });

  it('can only reuse an already approved usable token during early admission', () => {
    const issued = { scopes: ['operator.admin'] };
    const next = vi.fn(() => issued);
    let existing: typeof issued | undefined = issued;
    let issuerMatches = true;
    const ensure = compiled('device-pairing-core.worker-CvwvCBkl.mjs', 'ensureDeviceTokenInWorker', {
      updatePairedDeviceInTransaction: (_id: string, action: (paired: object) => unknown) => action({}),
      requestDevicePairingMutationAdmission: vi.fn(),
      normalizeDeviceAuthScopes: (scopes: string[]) => scopes,
      resolveDeviceTokenUpdateContext: () => ({ device: {}, role: 'operator', tokens: {}, existing }),
      resolveNodePairingGeneration: vi.fn(),
      resolveApprovedDeviceScopeBaseline: () => ['operator.admin'],
      scopesWithinApprovedDeviceBaseline: () => true,
      deviceTokenIssuerMatches: () => issuerMatches,
      roleScopesAllow: () => true,
      createDeviceAuthToken: next,
      clearNodePairingGenerationState: vi.fn(),
    });
    const params = { deviceId: 'test-device', role: 'operator', scopes: ['operator.admin'] };
    expect(ensure({ ...params, reuseOnly: true })).toEqual({ value: issued });
    issuerMatches = false;
    expect(ensure({ ...params, reuseOnly: true })).toEqual({ value: null });
    existing = undefined;
    expect(ensure({ ...params, reuseOnly: true })).toEqual({ value: null });
    expect(next).not.toHaveBeenCalled();
    expect(ensure(params).value).toBe(issued);
    expect(next).toHaveBeenCalledOnce();
  });

  it('defers first pairing, identity changes and upgrades without asking the store for a grant', async () => {
    const retry = vi.fn();
    const load = vi.fn();
    const authorizeExisting = vi.fn();
    const issue = vi.fn();
    const authorize = compiled(messages, 'authorizeGatewayConnectDevice', {
      rejectGatewayStartupConnect: retry,
      normalizeNodeHostCompatibilityMetadata: (client: object) => client,
      isBrowserCopilotClient: () => false,
      getPairedDevice: load,
      authorizeExistingGatewayDevice: authorizeExisting,
      issueGatewayConnectDeviceTokens: issue,
    });
    const context = { handler: {}, configSnapshot: {}, connectParams: { ...desktop } };
    const state = {
      earlyOperator: true, role: 'operator', scopes: desktop.scopes, device: desktop.device,
      devicePublicKey: 'old-key', authMethod: 'token', authResult: {}, controlUiPairingKind: null,
    };
    const paired = { publicKey: 'old-key', clientId: 'gateway-client', clientMode: 'ui' };
    for (const record of [undefined, { ...paired, publicKey: 'other-key' }, { ...paired, clientId: 'other-client' }]) {
      load.mockResolvedValue(record);
      expect(await authorize(context, state)).toBeUndefined();
    }
    expect(authorizeExisting).not.toHaveBeenCalled();
    load.mockResolvedValue(paired);
    for (const reason of ['scope-upgrade', 'role-upgrade', 'metadata-upgrade']) {
      authorizeExisting.mockImplementationOnce(async ({ requirePairing }) => ({ ok: await requirePairing(reason, paired) }));
      expect(await authorize(context, state)).toBeUndefined();
    }
    expect(retry).toHaveBeenCalledTimes(6);
    expect(issue).not.toHaveBeenCalled();
  });

  it('retains the normal plugin capability URL while withholding authorization until ready', () => {
    const capabilityFile = 'plugin-node-capability-3KBblmAq.mjs';
    let pending = true;
    const client = {
      internal: { operatorStartup: { unavailable: () => pending } },
      pluginNodeCapabilities: { canvas: { capability: 'sample', expiresAtMs: 20 } },
    };
    const surface = { surface: 'canvas' };
    const dependencies = {
      resolvePluginNodeCapabilityStorageKey: () => 'canvas',
      pluginNodeCapabilityFromScopedHostUrl: () => 'sample',
      normalizeOptionalString: (value: string) => value,
      resolvePluginNodeCapabilityExpiresAtMs: () => 30,
      isFutureDateTimestampMs: () => true,
      safeEqualSecret: (left: string, right: string) => left === right,
    };
    const checkUrl = compiled(capabilityFile, 'hasAuthorizedClientPluginNodeCapabilityUrl', dependencies);
    const checkBearer = compiled(capabilityFile, 'hasAuthorizedPluginNodeCapability', dependencies);
    for (pending of [true, false]) {
      expect(checkUrl({ client, surface, url: 'scoped' })).toBe(!pending);
      expect(checkBearer({ clients: [client], surface, capability: 'sample' })).toBe(!pending);
    }
  });

  it('waits on a cold owner catalog through the existing read path and releases its lease', async () => {
    const owner = { id: 'gateway-owner' };
    const read = vi.fn().mockReturnValue(undefined);
    const release = vi.fn();
    const prepare = vi.fn(async () => ({ release }));
    const assertCurrent = vi.fn();
    const get = compiled('user-profile-writes-CuERyiG4.mjs', 'readExistingGatewayOwnerProfile', {
      resolveDatabasePath: () => 'state.db',
      readResidentGatewayOwnerProfile: read,
      prepareUserProfileCatalog: prepare,
    });
    expect(await get({ assertCurrent })).toBeUndefined();
    read.mockReturnValueOnce(undefined).mockReturnValueOnce(owner);
    expect(await get({ assertCurrent })).toEqual(owner);
    expect(release).toHaveBeenCalledTimes(2);
    read.mockReturnValue(owner);
    expect(await get({ assertCurrent })).toEqual(owner);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('requires the canonical unmerged gateway.local owner even when its optional Windows display name is empty', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const readOwner = compiled('user-profile-list-k-ICsZt4.mjs', 'readResidentGatewayOwnerProfile', {
      profileCatalogs: new Map([['state.db', { valid: true, rows }]]),
      GATEWAY_OWNER_PROFILE_ID: 'gateway-owner',
      toUserProfile: (row: object) => row,
    });
    const get = compiled('user-profile-writes-CuERyiG4.mjs', 'readExistingGatewayOwnerProfile', {
      resolveDatabasePath: () => 'state.db',
      readResidentGatewayOwnerProfile: readOwner,
      prepareUserProfileCatalog: async () => ({ release: vi.fn() }),
    });
    const profile = { id: 'gateway-owner', display_name: null, gatewayOwnerCreatedAt: 1 };
    rows.set('other', { ...profile, id: 'other' });
    expect(await get({})).toBeUndefined();
    rows.set('gateway-owner', { ...profile, merged_into: 'other' });
    expect(await get({})).toBeUndefined();
    rows.set('gateway-owner', { ...profile, gatewayOwnerCreatedAt: undefined });
    expect(await get({})).toBeUndefined();
    rows.set('gateway-owner', profile);
    expect(await get({})).toEqual({ ...profile, created_at: 1 });
  });

  it('delivers the requested model snapshot once through the dispatcher or cancels on disconnect', async () => {
    const race = compiled('src-Bzfi3cQM.mjs', 'racePromiseWithAbortSignal', {
      createAbortError: () => new Error('aborted'),
    });
    const publish = compiled(messages, 'publishConnectModelCatalog', {
      GATEWAY_CLIENT_IDS: { CONTROL_UI: 'control-ui' },
      GATEWAY_CLIENT_CAPS: { MODEL_CATALOG_SNAPSHOT: 'models' },
      hasGatewayClientCap: () => true,
      racePromiseWithAbortSignal: race,
      Buffer,
    });
    for (const disconnect of [false, true]) {
      const controller = new AbortController();
      const client = {
        connect: { client: { id: 'control-ui' }, caps: ['models'], modelCatalog: { sessionKey: 'agent:main:main' } },
        connectionSignal: controller.signal,
      };
      let markReady!: () => void;
      const ready = new Promise<void>(resolve => { markReady = resolve; });
      const send = vi.fn();
      const dispatch = vi.fn((_request, _client, _bytes, _meta, respond) => respond({ ok: true, payload: ['example'] }));
      const pending = publish({ getClient: () => client, operatorStartup: { ready }, connId: 'one', send }, { dispatch });
      expect(dispatch).not.toHaveBeenCalled();
      if (disconnect) controller.abort();
      if (disconnect) await expect(pending).rejects.toThrow('aborted');
      markReady();
      if (!disconnect) {
        await pending;
        expect(dispatch).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ event: 'models.snapshot' }));
      } else expect(dispatch).not.toHaveBeenCalled();
    }
  });
});
