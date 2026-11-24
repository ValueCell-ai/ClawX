// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const bundle = readFileSync(path.join(dist, 'message-handler-DSPg7e4A.mjs'), 'utf8');
const gateway = readFileSync(path.join(dist, 'gateway-prewarm.js'), 'utf8');

function compile(source: string, name: string, dependencies: Record<string, unknown>) {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  if (!match) throw new Error('Missing OpenClaw function ' + name);
  return runInNewContext('(' + match[0] + ')', dependencies);
}

describe('authenticated desktop startup ready notification', () => {
  it('starts exactly once after hello delivery and uses the scoped, sequenced broadcaster', () => {
    const hello = bundle.slice(bundle.indexOf('async function sendGatewayHello('), bundle.indexOf('//#endregion', bundle.indexOf('async function sendGatewayHello(')));
    expect(hello.indexOf('await sendFrame({')).toBeLessThan(hello.indexOf('onHelloDelivered();'));
    expect(hello.indexOf('onHelloDelivered();')).toBeLessThan(hello.indexOf('() => publishClawXStartupReady('));
    expect(hello.match(/\(\) => publishClawXStartupReady\(/g)).toHaveLength(1);
    expect(hello).toContain('events: state.earlyOperator ? [...events, "gateway.ready"] : events');
    expect(gateway).toContain('"gateway.ready": [READ_SCOPE]');
    expect(gateway).toContain('event === "gateway.ready" && (targetConnIds?.size !== 1 || !c.internal?.operatorStartup');
  });

  it.each(['normal', 'already-ready', 'disconnect', 'shutdown', 'replacement', 'closing', 'auth-change', 'invalidated'])(
    'delivers to the originating socket only after full startup for %s',
    async (mode) => {
      const transport = new AbortController();
      const lifetime = new AbortController();
      let settle!: () => void;
      const ready = new Promise<void>(resolve => { settle = resolve; });
      const startup = { ready, unavailable: () => mode === 'closing' ? true : undefined };
      const client = { connId: 'one', connectionSignal: transport.signal, internal: { operatorStartup: startup } };
      const broadcastToConnIds = vi.fn();
      const handler = {
        isClosed: () => false,
        getClient: () => mode === 'replacement' ? {} : client,
        connectionWork: { signal: lifetime.signal },
        buildRequestContext: () => ({ broadcastToConnIds }),
      };
      const race = compile(readFileSync(path.join(dist, 'src-Bzfi3cQM.mjs'), 'utf8'), 'racePromiseWithAbortSignal', {
        createAbortError: () => new Error('aborted'),
      });
      const publish = compile(bundle, 'publishClawXStartupReady', {
        racePromiseWithAbortSignal: race,
        hasCurrentGatewayPolicyClientSource: () => mode !== 'invalidated',
        resolveGatewayConnectPolicyFailure: () => mode === 'auth-change' ? { kind: 'auth' } : undefined,
        AbortSignal,
      });
      if (mode === 'already-ready') settle();
      const delivery = publish({ handler }, {}, client);
      expect(broadcastToConnIds).not.toHaveBeenCalled();
      if (mode === 'disconnect') transport.abort();
      if (mode === 'shutdown') lifetime.abort();
      if (mode === 'disconnect' || mode === 'shutdown') await delivery;
      settle();
      await delivery;
      if (mode === 'normal' || mode === 'already-ready') {
        expect(broadcastToConnIds).toHaveBeenCalledOnce();
        const [event, payload, targets] = broadcastToConnIds.mock.calls[0];
        expect(event).toBe('gateway.ready');
        expect(payload).toEqual({});
        expect([...targets]).toEqual(['one']);
      } else expect(broadcastToConnIds).not.toHaveBeenCalled();
    },
  );
});
