// Exercise the installed HTTP handler and tool dispatcher. Replace external authentication,
// session storage and channel execution with isolated fixtures. No listener or upload is needed.
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const dist = path.resolve('node_modules/openclaw/dist');
const http = 'tools-invoke-http-BCqx9nHO.mjs';
const dispatcher = 'tools-invoke-shared-CGhBS7S7.mjs';
const dependencies = {
  'http-auth-utils-BzoDAf7l.mjs': `export const o = async () => ({
    cfg: {}, requestAuth: { assertCurrent() {}, revalidate() {} }, operatorScopes: ['operator.admin']
  }), l = () => true;`,
  'tool-resolution-BaHralQC.mjs': `export const t = async () => ({
    agentId: 'main', workspaceDir: process.env.OPENCLAW_STATE_DIR,
    tools: [{ name: 'message', execute() { throw globalThis.fixtureToolError; } }]
  });`,
  'session-utils-store-worker-CX8yJSYT.mjs': 'export const t = async () => ({});',
  'runtime-snapshot-vj1MIh8M.mjs': 'export const g = () => ({});',
  'agent-tools.before-tool-call-B6crFObs.mjs': 'export const _ = async ({params}) => ({params});',
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith(http) || context.parentURL?.endsWith(dispatcher)) {
      const fixture = dependencies[path.basename(specifier)];
      if (fixture) return { url: 'data:text/javascript,' + encodeURIComponent(fixture), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { handleToolsInvokeHttpRequest } = await load(http);
const { t: GatewayClientRequestError } = await load('request-error-CnPCYq3A.mjs');
const { OutboundMediaLimitError } = await load('store.shared-CVpD4EkK.mjs');

async function invoke(error) {
  globalThis.fixtureToolError = error;
  const socket = new EventEmitter();
  const bytes = Buffer.from(JSON.stringify({ tool: 'message', action: 'send', args: { channel: 'wecom' } }));
  const req = Object.assign(Readable.from([bytes]), { method: 'POST', url: '/tools/invoke', headers: {}, socket });
  let body;
  const res = Object.assign(new EventEmitter(), {
    socket, setHeader() {},
    end(value) { body = JSON.parse(value); this.emit('finish'); },
  });
  await handleToolsInvokeHttpRequest(req, res, { resolveGatewayContext: () => ({}) });
  return { status: res.statusCode, ...body };
}
const secret = '/private/workspace/unpublished.xlsm';
const details = { code: 'OUTBOUND_MEDIA_TOO_LARGE', channel: 'wecom', limitBytes: 5242880, actualBytes: 10370000, path: secret };
const responses = {
  rpc: await invoke(new GatewayClientRequestError({ code: 'INVALID_REQUEST', details, message: secret })),
  direct: await invoke(new OutboundMediaLimitError(secret, details.limitBytes, details.actualBytes)),
  unknown: await invoke(new Error(secret)),
  forbidden: await invoke(new GatewayClientRequestError({ code: 'FORBIDDEN', details, message: 'denied' })),
  queued: await invoke(new GatewayClientRequestError({ code: 'UNAVAILABLE', details: { code: 'OUTBOUND_DELIVERY_QUEUED' }, message: secret })),
};
console.log(JSON.stringify(responses));
