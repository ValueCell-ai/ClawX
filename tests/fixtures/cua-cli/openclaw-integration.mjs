// Run in a disposable HOME supplied by the test, not the developer's OpenClaw state.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOpenClawCodingTools, OPENCLAW_VERSION } from 'openclaw/plugin-sdk/agent-harness';

const root = process.env.HOME;
assert.equal(process.env.OPENCLAW_STATE_DIR, join(root, '.openclaw'));
const workspace = join(root, 'workspace with spaces');
await mkdir(workspace, { recursive: true });
const binaryPath = join(root, "bundled driver's CLI.mjs");
await copyFile(new URL('./fake-cli.mjs', import.meta.url), binaryPath);
await chmod(binaryPath, 0o700);
const descriptor = {
  v: 2, generation: 'synthetic-generation-1', driverVersion: '0.21.0',
  binaryPath, socketPath: join(root, 'host endpoint.sock'),
};
const descriptorPath = join(root, 'connection descriptor.json');
await writeFile(descriptorPath, JSON.stringify(descriptor));
const screenshotPath = join(workspace, 'fresh state 001.png');
const failedScreenshotPath = join(workspace, 'failed state 002.png');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const calls = [];
const sessions = new Map();
const endpointErrors = [];
const server = createServer((socket) => {
  let input = '';
  socket.on('error', (error) => endpointErrors.push(error.message));
  socket.on('data', async (chunk) => {
    input += chunk;
    if (!input.endsWith('\n')) return;
    try {
      const call = JSON.parse(input);
      calls.push(call);
      const { tool, args } = call;
      assert.equal(call.endpoint, descriptor.socketPath);
      assert.equal(args.session, 'clawx-integration-workflow');
      let result;
      if (tool === 'list_windows') {
        assert.equal(sessions.has(args.session), false);
        sessions.set(args.session, { observations: 0 });
        result = { windows: [{ pid: 844, window_id: 10725 }] };
      } else {
        const session = sessions.get(args.session);
        assert.ok(session, 'Separate CLI processes must reach the existing named session');
        if (tool === 'get_window_state') {
          assert.equal(args.pid, 844);
          assert.equal(args.window_id, 10725);
          if (args.screenshot_out_file === failedScreenshotPath) {
            result = { error: { code: 'SCREENSHOT_WRITE_FAILED', message: 'Synthetic capture failure' } };
          } else {
            assert.equal(args.screenshot_out_file, screenshotPath);
            await writeFile(screenshotPath, png, { flag: 'wx' });
            session.observations += 1;
            result = { screenshot_file_path: screenshotPath, screenshot_width: 1, screenshot_height: 1 };
          }
        } else if (tool === 'verify_state') {
          assert.equal(session.observations, 1);
          result = { status: 'unsatisfied' };
        } else {
          assert.equal(tool, 'end_session');
          sessions.delete(args.session);
          result = { ended: true };
        }
      }
      // Like the CLI's zero-exit semantic failures, error data stays on stdout.
      socket.end(`${JSON.stringify(result)}\n`);
    } catch (error) {
      endpointErrors.push(error.message);
      socket.destroy();
    }
  });
});
server.listen(descriptor.socketPath);
await once(server, 'listening');

try {
  const tools = createOpenClawCodingTools({
    workspaceDir: workspace,
    config: { tools: { allow: ['exec', 'read'], fs: { workspaceOnly: true } }, plugins: { enabled: false } },
    toolConstructionPlan: {
      includeBaseCodingTools: true, includeShellTools: true,
      includeChannelTools: false, includeOpenClawTools: false, includePluginTools: false,
    },
    // Only this isolated tool instance permits the test-owned executable. No policy file is edited.
    exec: { host: 'gateway', security: 'full', ask: 'off', notifyOnExit: false, timeoutSec: 10 },
    modelProvider: 'openai', modelId: 'gpt-4o', modelApi: 'openai-completions', modelHasVision: true,
  });
  const exec = tools.find((tool) => tool.name === 'exec');
  const read = tools.find((tool) => tool.name === 'read');
  assert.ok(exec);
  assert.ok(read);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const skill = await readFile(new URL('../../../resources/skills/computer-use/SKILL.md', import.meta.url), 'utf8');
  const bootstrap = [...skill.matchAll(/```sh\n([\s\S]*?)\n```/g)][0][1];
  const boot = await exec.execute('bootstrap', {
    command: bootstrap, env: { CLAWX_CUA_CONNECTION_FILE: descriptorPath },
  });
  const text = (result) => result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  const decoded = JSON.parse(text(boot));
  assert.deepEqual(decoded, descriptor);
  const execute = (id, tool, args = {}) => exec.execute(id, {
    command: `${quote(decoded.binaryPath)} --socket ${quote(decoded.socketPath)} call ${tool} ${quote(JSON.stringify({ session: 'clawx-integration-workflow', ...args }))}`,
  });
  const discovery = await execute('discover', 'list_windows');
  const target = JSON.parse(text(discovery)).windows[0];
  const capture = await execute('capture', 'get_window_state', { ...target, screenshot_out_file: screenshotPath });
  const returnedPath = JSON.parse(text(capture)).screenshot_file_path;
  assert.deepEqual(await readFile(returnedPath), png);
  const image = await read.execute('read-image', { path: returnedPath });
  assert.equal(image.content.find((part) => part.type === 'image')?.data, png.toString('base64'));
  const verification = await execute('verify', 'verify_state', {
    ...target, expect: [{ element: { selector: { label_contains: 'Saved' }, exists: true } }],
    include_screenshot: false,
  });
  const failure = await execute('capture-failure', 'get_window_state', { ...target, screenshot_out_file: failedScreenshotPath });
  let missingImageError;
  try {
    await read.execute('read-missing', { path: failedScreenshotPath });
  } catch (error) {
    missingImageError = error.message;
  }
  const cleanup = await execute('cleanup', 'end_session');

  // Resolve public exports from OpenClaw's own pinned dependency, not a second AI library.
  const require = createRequire(import.meta.resolve('openclaw'));
  const ai = await import(pathToFileURL(require.resolve('@openclaw/ai')).href);
  const providers = await import(pathToFileURL(require.resolve('@openclaw/ai/providers')).href);
  const requests = [];
  ai.configureAiTransportHost({
    buildModelFetch: () => async (input, init) => {
      const request = new Request(input, init);
      // This is the SDK's serialized HTTP body at fetch, NOT a test-built message array.
      requests.push({ url: request.url, method: request.method, body: JSON.parse(await request.text()) });
      return new Response([
        'data: {"id":"synthetic","choices":[{"index":0,"delta":{"role":"assistant","content":"Synthetic response"},"finish_reason":null}]}',
        'data: {"id":"synthetic","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]', '',
      ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const runtime = ai.createLlmRuntime();
  providers.registerBuiltInApiProviders(runtime.registry);
  const model = {
    id: 'gpt-4o', name: 'Synthetic vision route', provider: 'openai', api: 'openai-completions',
    baseUrl: 'https://cua-provider.invalid/v1', reasoning: false, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 128,
  };
  const responses = [];
  for (const [toolName, result] of [['exec', capture], ['read', image], ['exec', failure], ['exec', verification]]) {
    responses.push(await runtime.complete(model, { messages: [
      { role: 'user', content: 'Inspect the tool result.', timestamp: 0 },
      {
        role: 'assistant', content: [{ type: 'toolCall', id: 'call_cua', name: toolName, arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', timestamp: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      },
      { role: 'toolResult', toolCallId: 'call_cua', toolName, content: result.content, isError: result.isError === true, timestamp: 0 },
    ] }, { apiKey: 'synthetic-test-key', maxTokens: 32 }));
  }
  process.stdout.write(`CUA_INTEGRATION_RESULT=${JSON.stringify({
    version: OPENCLAW_VERSION,
    descriptor: decoded, bootstrap: boot, discovery, capture, image, verification, failure, cleanup,
    missingImageError, calls, remainingSessions: sessions.size, endpointErrors, requests, responses,
  })}\n`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
