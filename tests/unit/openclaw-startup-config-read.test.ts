// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

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

describe('OpenClaw config reads on an authenticated startup connection', () => {
  it('keeps the native capacity and timeout while independent history reads can start', async () => {
    let now = 0;
    const queue = runInNewContext([
      raceSource, messageSource.slice(queueStart, queueEnd), 'scheduleGatewayRequestStart',
    ].join('\n'), {
      setTimeout, clearTimeout, setImmediate: nextTurn, queueMicrotask,
      performance: { now: () => now },
      createAbortError: () => new Error('aborted'),
      createDeferredCore: deferred,
      runWithMainThreadTask: (_label: string, run: () => unknown) => run(),
      runOutsideGatewayRootWorkAdmission: (run: () => unknown) => run(),
    });
    const ready = deferred();
    const startup = { ready: ready.promise, unavailable: () => true };
    const read = (conn: string, method: string, wait?: typeof startup) =>
      queue(64, { method }, conn, Promise.resolve(), new AbortController().signal, wait);
    const pending = Array.from({ length: 255 }, () => read('desktop', 'config.get', startup));
    await read('desktop', 'chat.history');
    pending.push(read('desktop', 'config.get', startup));
    expect(read('desktop', 'config.get', startup)).toBeNull();
    await read('other-desktop', 'sessions.list');
    const drained = Promise.allSettled(pending);
    now = 30_001;
    ready.resolve();
    const expired = await drained;
    expect(expired.every((result) => result.status === 'rejected' && /30 seconds/.test(String(result.reason)))).toBe(true);
    await expect(read('desktop', 'chat.history')).resolves.toBeUndefined();
  });

  it.each(['complete', 'disconnect', 'gateway-close', 'revoked', 'registry-changed'])(
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
      const handler = {
        connId: 'one',
        clients: { retainRequest: () => release },
        buildRequestContext: () => requestContext,
        send, logGateway: { error: vi.fn() },
        getMethodRegistry: () => registry,
        isClosed: () => connection.signal.aborted,
        getClient: () => client,
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
