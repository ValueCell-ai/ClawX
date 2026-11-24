// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const messageSource = readFileSync(path.join(dist, 'message-handler-DSPg7e4A.mjs'), 'utf8');
const queueStart = messageSource.indexOf('//#region src/gateway/server/ws-connection/request-start.ts');
const queueEnd = messageSource.indexOf('//#endregion', queueStart);
const dispatcherEnd = messageSource.indexOf('//#endregion', queueEnd + 12);
const raceSource = readFileSync(path.join(dist, 'src-Bzfi3cQM.mjs'), 'utf8')
  .match(/^function racePromiseWithAbortSignal\([^\n]*\) \{[\s\S]*?^\}/m)![0];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function queueFixture() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const queue = runInNewContext([
    raceSource, messageSource.slice(queueStart, queueEnd), 'scheduleGatewayRequestStart',
  ].join('\n'), {
    setTimeout, clearTimeout, setImmediate: nextTurn, queueMicrotask,
    performance: { now: () => Date.now() },
    createAbortError: () => new Error('aborted'),
    createDeferredCore: deferred,
    runWithMainThreadTask: (_label: string, run: () => unknown) => run(),
    runOutsideGatewayRootWorkAdmission: (run: () => unknown) => run(),
  });
  const ready = deferred();
  let pending = true;
  const startup = { ready: ready.promise, unavailable: () => pending };
  const read = (conn: string, method: string, wait?: typeof startup, settled = Promise.resolve()) =>
    queue(64, { method }, conn, settled, new AbortController().signal, wait);
  return { read, startup, admit() { pending = false; ready.resolve(); } };
}

describe('OpenClaw config reads on an authenticated startup connection', () => {
  afterEach(() => vi.useRealTimers());

  it('admits a startup config read after 61 seconds on the same connection', async () => {
    const { read, startup, admit } = queueFixture();
    const finished = vi.fn();
    const result = read('desktop', 'config.get', startup).then(finished, finished);
    await vi.advanceTimersByTimeAsync(61_000);
    await nextTurn();
    expect(finished).not.toHaveBeenCalled();
    admit();
    await result;
    expect(finished).toHaveBeenCalledWith(undefined);
  });

  it('retains the original capacity and expires gated config reads at the startup limit', async () => {
    const { read, startup } = queueFixture();
    const pending = Array.from({ length: 255 }, () => read('desktop', 'config.get', startup));
    await read('desktop', 'chat.history');
    pending.push(read('desktop', 'config.get', startup));
    expect(read('desktop', 'config.get', startup)).toBeNull();
    await read('other-desktop', 'sessions.list');
    const drained = Promise.allSettled(pending);
    await vi.advanceTimersByTimeAsync(599_999);
    await nextTurn();
    expect(read('desktop', 'config.get', startup)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const expired = await drained;
    expect(expired.every((result) => result.status === 'rejected' && /10 minutes/.test(String(result.reason)))).toBe(true);
    await expect(read('desktop', 'chat.history')).resolves.toBeUndefined();
  });

  it('wakes for an ordinary 30-second deadline behind a gated config read', async () => {
    const { read, startup, admit } = queueFixture();
    const hold = deferred();
    await Promise.all(Array.from({ length: 4 }, () => read('worker', 'sessions.subscribe', undefined, hold.promise)));
    const long = Promise.allSettled([read('desktop', 'config.get', startup)]);
    const expired = vi.fn();
    const ordinary = read('worker', 'models.list').catch(expired);
    try {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(expired).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await nextTurn();
      expect(expired).toHaveBeenCalledOnce();
      expect(String(expired.mock.calls[0][0])).toContain('30 seconds');
    } finally {
      hold.resolve();
      admit();
    }
    await ordinary;
    expect(await long).toEqual([{ status: 'fulfilled', value: undefined }]);
  });

  it.each(['complete', 'disconnect', 'reconnect', 'gateway-close', 'revoked', 'registry-changed'])(
    'preserves dispatch authority and releases queued requests on %s',
    async (outcome) => {
      const ready = deferred();
      let pending = true;
      let authorized = true;
      const connection = new AbortController();
      const lifecycle = new AbortController();
      const client = {
        connect: { role: 'operator', client: { id: 'gateway-client' } },
        internal: { operatorStartup: { unavailable: () => pending || undefined, ready: ready.promise } },
        connectionSignal: connection.signal,
      };
      const snapshot = {
        exists: true,
        valid: true,
        config: { agents: { entries: { main: {}, 'qa-second': {} } } },
      };
      const before = vi.fn();
      const current = vi.fn(() => snapshot);
      const registryFor = (handler: () => unknown, owner: string) => ({
        descriptors: () => [{ name: 'config.get', owner: { kind: owner }, scope: 'operator.read' }],
        getHandler: () => handler,
      });
      let registry = registryFor(before, 'core');
      const send = vi.fn(() => ({ kind: 'sent' }));
      const release = vi.fn();
      const requestContext = { getRuntimeConfig: () => ({}), requestEntryLifetime: undefined };
      let currentClient = client;
      const handler = {
        connId: 'one',
        clients: { retainRequest: () => release },
        buildRequestContext: () => requestContext,
        send, logGateway: { error: vi.fn() },
        getMethodRegistry: () => registry,
        isClosed: () => connection.signal.aborted,
        getClient: () => currentClient,
        connectionWork: { signal: lifecycle.signal },
      };
      const serve = vi.fn(({ req, respond, methodRegistry }) => {
        respond(true, methodRegistry.getHandler(req.method)());
      });
      const code = [raceSource, messageSource.slice(queueStart, dispatcherEnd), 'createGatewayAuthenticatedRequestDispatcher'].join('\n');
      const create = runInNewContext(code, {
        AbortSignal, AbortController, setTimeout, clearTimeout, setImmediate: nextTurn, queueMicrotask, performance,
        createAbortError: () => new Error('aborted'),
        createDeferredCore: deferred,
        runWithMainThreadTask: (_label: string, run: () => unknown) => run(),
        runOutsideGatewayRootWorkAdmission: (run: () => unknown) => run(),
        validateRequestFrame: () => true,
        isGatewayAuthPolicyCurrent: () => true,
        createGatewayRpcDiagnostics: () => undefined,
        createLazyPromise: () => async () => ({ handleGatewayRequest: serve }),
        logWs: vi.fn(),
        SharedGatewaySessionGenerationState: { fromReader: () => undefined },
        captureGatewayDeviceRevocation: () => ({ isCurrent: () => authorized, release }),
        registerGatewayPolicyResponse: () => undefined,
        parseDiagnosticTraceparent: () => undefined,
        bindWebSocketRequestMutationAuthority: (options: object) => options,
        classifyGatewayStaleInstall: () => undefined,
        formatForLog: String,
        errorShape: (code: string, message: string) => ({ code, message }),
        ErrorCodes: { UNAVAILABLE: 'UNAVAILABLE' },
      });
      const rpc = create({ handler });
      const response = rpc.dispatch({ type: 'req', id: 'read', method: 'config.get', params: {} }, client, 80);
      await nextTurn();
      expect(serve).not.toHaveBeenCalled();
      expect(before).not.toHaveBeenCalled();
      registry = registryFor(current, outcome === 'registry-changed' ? 'plugin' : 'core');
      if (outcome === 'disconnect') connection.abort();
      if (outcome === 'reconnect') currentClient = { ...client };
      if (outcome === 'gateway-close') lifecycle.abort();
      if (outcome === 'revoked') authorized = false;
      if (outcome === 'disconnect' || outcome === 'gateway-close') await response;
      pending = false;
      ready.resolve();
      await response;
      expect(release).toHaveBeenCalledTimes(2);
      if (outcome === 'complete') {
        expect(current).toHaveBeenCalledOnce();
        expect(serve).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith({ type: 'res', id: 'read', ok: true, payload: snapshot, error: undefined });
      } else {
        expect(serve).not.toHaveBeenCalled();
        expect(current).not.toHaveBeenCalled();
        if (outcome === 'registry-changed') expect(send).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      }
    },
  );
});
