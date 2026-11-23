// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { applyProviderModelCompatibility } from '@electron/shared/providers/model-compat';

const requireRuntime = createRequire(import.meta.url);
const dist = join(process.cwd(), 'node_modules/openclaw/dist');
const providerKey = 'custom-enterpri';

it('preserves alternate protocols, explicit compatibility and other model catalogs', () => {
  const id = 'deepseek-v4.1-flash';
  for (const [key, row] of [
    ['custom-other', { id, reasoning: false }],
    ['custom-other', { id, reasoning: false, compat: { thinkingFormat: 'deepseek' } }],
    [providerKey, { id, api: 'openai-responses', reasoning: false }],
    [providerKey, { id, compat: { thinkingFormat: 'openrouter' } }],
    [providerKey, { id, compat: { supportsReasoningEffort: false } }],
    [providerKey, { id: 'deepseek-v4.1-flash-experimental', reasoning: false }],
  ] as const) {
    const provider = { api: 'openai-completions', models: [structuredClone(row)] };
    applyProviderModelCompatibility(provider, key);
    expect(provider.models).toEqual([row]);
  }
  const optedIn = { id, reasoning: true, compat: { thinkingFormat: 'deepseek', supportedReasoningEfforts: ['high'] } };
  const provider = { api: 'openai-completions', models: [structuredClone(optedIn)] };
  applyProviderModelCompatibility(provider, 'custom-other');
  expect(provider.models).toEqual([optedIn]);
});

it('sends the selected DeepSeek toggle, effort and replay history over Chat Completions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawx-deepseek-'));
  vi.stubEnv('OPENCLAW_HOME', root);
  vi.stubEnv('OPENCLAW_STATE_DIR', join(root, '.openclaw'));
  vi.stubEnv('OPENCLAW_CONFIG_PATH', join(root, '.openclaw/openclaw.json'));
  type Body = { model: string; thinking?: { type: string }; reasoning_effort?: string; messages: { role: string; reasoning_content?: string }[] };
  const bodies: Body[] = [];
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    const body: Body = JSON.parse(Buffer.concat(parts).toString());
    bodies.push(body);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (body.thinking?.type === 'enabled') {
      response.write('data: {"choices":[{"index":0,"delta":{"reasoning_content":"fixture reasoning"}}]}\n\n');
    }
    response.end('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const { createOpenAICompletionsTransportStreamFn } = requireRuntime('@openclaw/ai/transports');
    const { applyExtraParamsToAgent } = requireRuntime(join(dist, 'extra-params-BWYmu9bZ.mjs'));
    const { d: resolveThinkingProfile } = requireRuntime(join(dist, 'thinking-DRIfSqta.mjs'));
    for (const id of ['deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017']) {
      const row = { id, name: id, reasoning: false, input: ['text'], contextWindow: 32_768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
      const provider = { api: 'openai-completions', baseUrl: `http://127.0.0.1:${address.port}/v1`, models: [row] };
      applyProviderModelCompatibility(provider, providerKey);
      const model = { ...row, provider: providerKey, api: provider.api, baseUrl: provider.baseUrl };
      const config = { plugins: { enabled: false }, models: { providers: { [providerKey]: provider } } };
      const profile = resolveThinkingProfile({ provider: providerKey, model: id, agentRuntime: 'openclaw', catalog: [model] });
      expect(profile.levels.map((level: { id: string }) => level.id)).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
      const context = { messages: [{ role: 'user', content: 'first', timestamp: 1 }] };
      for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'off']) {
        const agent = { streamFn: createOpenAICompletionsTransportStreamFn() };
        applyExtraParamsToAgent(agent, config, providerKey, id, undefined, level, 'main', root, model, root);
        const answer = await agent.streamFn(model, context, { apiKey: 'local-test', reasoning: level }).result();
        expect(answer.errorMessage).toBeUndefined();
        const sent = bodies.at(-1)!;
        expect(sent.model).toBe(id);
        if (level === 'off') {
          expect(sent.thinking).toEqual({ type: 'disabled' });
          expect(sent).not.toHaveProperty('reasoning_effort');
          expect(sent.messages.filter(message => message.role === 'assistant')).not.toHaveLength(0);
          expect(sent.messages.every(message => !Object.hasOwn(message, 'reasoning_content'))).toBe(true);
        } else {
          expect(sent.thinking).toEqual({ type: 'enabled' });
          expect(sent.reasoning_effort).toBe(['max', 'xhigh'].includes(level) ? 'max' : 'high');
          for (const message of sent.messages.filter(message => message.role === 'assistant')) {
            expect(message).toHaveProperty('reasoning_content');
          }
        }
        context.messages.push(answer, { role: 'user', content: 'next', timestamp: 2 });
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
