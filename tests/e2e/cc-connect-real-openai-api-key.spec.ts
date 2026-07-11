import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { loadDefaultCcConnectLocalRealEnv } from './helpers/local-real-env';
import type { Page } from '@playwright/test';

const execFileAsync = promisify(execFile);

loadDefaultCcConnectLocalRealEnv();

type RuntimeBundles = {
  ccConnectPath: string;
  codexPath: string;
};

type OpenAiCompatibleRequest = {
  method?: string;
  url?: string;
  authorization?: string | string[];
  body?: string;
};

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function realRuntimeBundles(): Promise<RuntimeBundles | null> {
  const platformArch = `${process.platform}-${process.arch}`;
  const ccConnectPath = join(
    process.cwd(),
    'build',
    'cc-connect',
    platformArch,
    process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect',
  );
  const codexPath = join(
    process.cwd(),
    'build',
    'codex',
    platformArch,
    'bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  );
  try {
    await access(ccConnectPath);
    await access(codexPath);
    return { ccConnectPath, codexPath };
  } catch {
    return null;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPortClosed(port: number): Promise<void> {
  await expect.poll(async () => await isPortOpen(port), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `cc-connect port ${port} should be free before real OpenAI API key smoke starts`,
  }).toBe(false);
}

async function listProcessCommandsContaining(needle: string): Promise<string[]> {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(needle))
    .filter((line) => !line.includes('ps -axo'));
}

async function waitForNoRuntimeProcesses(runtimeDir: string): Promise<void> {
  if (process.platform === 'win32') return;
  await expect.poll(async () => await listProcessCommandsContaining(runtimeDir), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `no real OpenAI API key runtime process should reference ${runtimeDir}`,
  }).toEqual([]);
}

async function stopRuntime(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.clawx.hostInvoke({
      id: `runtime-stop-${Date.now()}`,
      module: 'gateway',
      action: 'stop',
    });
  }).catch(() => undefined);
}

function requiredOpenAiApiKey(): string {
  const value = process.env.OPENAI_API_KEY?.trim() || process.env.CLAWX_REAL_OPENAI_API_KEY?.trim();
  test.skip(!value, 'Set CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY for the real cc-connect OpenAI API key smoke.');
  return value ?? '';
}

async function expectAssistantText(page: Page, text: string, timeout = 180_000): Promise<void> {
  await expect(page.getByTestId('chat-message-role-assistant').filter({ hasText: text }).last()).toBeVisible({ timeout });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('OpenAI-compatible mock server did not bind to a TCP port');
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }).catch(() => {});
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeSse(res: ServerResponse, type: string, payload: Record<string, unknown>): void {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function responseStreamParts(text: string, model: string) {
  const now = Math.floor(Date.now() / 1000);
  const response = {
    id: 'resp_clawx_local_openai',
    object: 'response',
    created_at: now,
    status: 'in_progress',
    model,
    output: [],
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [],
    usage: null,
  };
  const item = {
    id: 'msg_clawx_local_openai',
    type: 'message',
    status: 'in_progress',
    role: 'assistant',
    content: [],
  };
  const doneItem = {
    ...item,
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };

  return { response, item, doneItem };
}

function writeResponseStreamStart(res: ServerResponse, text: string, model: string): void {
  const { response, item } = responseStreamParts(text, model);
  writeSse(res, 'response.created', { response });
  writeSse(res, 'response.in_progress', { response });
  writeSse(res, 'response.output_item.added', { output_index: 0, item });
  writeSse(res, 'response.content_part.added', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
}

function writeResponseStreamCompletion(res: ServerResponse, text: string, model: string): void {
  const { response, item, doneItem } = responseStreamParts(text, model);
  writeSse(res, 'response.output_text.delta', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: text,
  });
  writeSse(res, 'response.output_text.done', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    text,
  });
  writeSse(res, 'response.content_part.done', {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text, annotations: [] },
  });
  writeSse(res, 'response.output_item.done', { output_index: 0, item: doneItem });
  writeSse(res, 'response.completed', {
    response: {
      ...response,
      status: 'completed',
      output: [doneItem],
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        total_tokens: 19,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeResponseStream(res: ServerResponse, text: string, model: string): void {
  writeResponseStreamStart(res, text, model);
  writeResponseStreamCompletion(res, text, model);
}

function createOpenAiCompatibleServer(options: {
  expectedApiKey: string;
  model: string;
  responseText: string;
  requests: OpenAiCompatibleRequest[];
  delayCompletion?: boolean;
  responseStarted?: Deferred<void>;
  releaseCompletion?: Promise<void>;
  responseClosed?: Deferred<void>;
}): Server {
  return createServer(async (req, res) => {
    const body = await readRequestBody(req);
    options.requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body,
    });

    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: options.model, object: 'model' }] }));
      return;
    }

    if (!req.url?.includes('/responses')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }

    if (req.headers.authorization !== `Bearer ${options.expectedApiKey}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'missing bearer token' } }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (options.delayCompletion) {
      let closed = false;
      const markClosed = () => {
        if (closed) return;
        closed = true;
        options.responseClosed?.resolve();
      };
      req.once('close', markClosed);
      res.once('close', markClosed);
      writeResponseStreamStart(res, options.responseText, options.model);
      options.responseStarted?.resolve();
      await options.releaseCompletion;
      if (!closed && !res.destroyed) {
        writeResponseStreamCompletion(res, options.responseText, options.model);
      }
      return;
    }
    writeResponseStream(res, options.responseText, options.model);
  });
}

test.describe('cc-connect real OpenAI API key runtime smoke', () => {
  test('sends a chat message through real cc-connect and Codex with a local OpenAI-compatible API key server', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const createdAt = new Date().toISOString();
    const apiKey = 'clawx-local-openai-compatible-key';
    const model = 'gpt-clawx-local';
    const responseText = 'CLAWX_LOCAL_OPENAI_COMPATIBLE_OK';
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const requests: OpenAiCompatibleRequest[] = [];
    const server = createOpenAiCompatibleServer({
      expectedApiKey: apiKey,
      model,
      responseText,
      requests,
    });
    const port = await listen(server);

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-local-api-key': {
          id: 'openai-local-api-key',
          vendorId: 'openai',
          label: 'OpenAI Local API Key',
          authMode: 'api_key',
          baseUrl: `http://127.0.0.1:${port}/v1/responses`,
          model,
          enabled: true,
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        'openai-local-api-key': {
          type: 'api_key',
          accountId: 'openai-local-api-key',
          apiKey,
        },
      },
      apiKeys: {},
      defaultProviderAccountId: 'openai-local-api-key',
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-local-openai-compatible',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill(`Reply exactly: ${responseText}`);
      await page.getByTestId('chat-composer-send').click();
      await expectAssistantText(page, responseText);

      await expect.poll(() => requests.some((request) => request.url?.includes('/responses')), {
        timeout: 10_000,
      }).toBe(true);
      expect(requests.some((request) => request.authorization === `Bearer ${apiKey}`)).toBe(true);

      const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
      expect(managedConfig).toContain('provider = "clawx-openai"');
      expect(managedConfig).toContain('api_key = "${OPENAI_API_KEY}"');
      expect(managedConfig).toContain(`base_url = "http://127.0.0.1:${port}/v1"`);
      expect(managedConfig).toContain(`model = "${model}"`);
      expect(managedConfig).not.toContain(apiKey);

      const codexConfig = await readFile(join(runtimeDir, 'codex-home', 'config.toml'), 'utf8');
      expect(codexConfig).toContain('model_provider = "clawx-openai"');
      expect(codexConfig).toContain(`base_url = "http://127.0.0.1:${port}/v1"`);
      expect(codexConfig).toContain('env_key = "OPENAI_API_KEY"');
      expect(codexConfig).not.toContain(apiKey);

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('OPENAI_API_KEY');
      expect(publicProfile).toContain('clawx-openai');
      expect(publicProfile).not.toContain(apiKey);

      await expect.poll(async () => {
        const result = await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-usage-local-openai-compatible',
            module: 'usage',
            action: 'recentTokenHistory',
            payload: { limit: 50, runtimeKind: 'cc-connect' },
          });
        });
        const entries = Array.isArray(result.data) ? result.data : [];
        return entries.some((entry) =>
          entry?.runtimeKind === 'cc-connect'
          && entry?.model === model
          && entry?.inputTokens >= 12
          && entry?.outputTokens >= 7
          && entry?.totalTokens >= 19
        );
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toBe(true);
    } finally {
      const page = await getStableWindow(app).catch(() => null);
      if (page) await stopRuntime(page);
      await closeElectronApp(app);
      await closeServer(server);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });

  test('stops a long-running local OpenAI-compatible API key chat without rendering late output', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const createdAt = new Date().toISOString();
    const apiKey = 'clawx-local-openai-compatible-abort-key';
    const model = 'gpt-clawx-local-abort';
    const responseText = 'CLAWX_ABORT_SHOULD_NOT_RENDER';
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const requests: OpenAiCompatibleRequest[] = [];
    const responseStarted = deferred<void>();
    const releaseCompletion = deferred<void>();
    const responseClosed = deferred<void>();
    const server = createOpenAiCompatibleServer({
      expectedApiKey: apiKey,
      model,
      responseText,
      requests,
      delayCompletion: true,
      responseStarted,
      releaseCompletion: releaseCompletion.promise,
      responseClosed,
    });
    const port = await listen(server);

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-local-api-key-abort': {
          id: 'openai-local-api-key-abort',
          vendorId: 'openai',
          label: 'OpenAI Local API Key Abort',
          authMode: 'api_key',
          baseUrl: `http://127.0.0.1:${port}/v1/responses`,
          model,
          enabled: true,
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        'openai-local-api-key-abort': {
          type: 'api_key',
          accountId: 'openai-local-api-key-abort',
          apiKey,
        },
      },
      apiKeys: {},
      defaultProviderAccountId: 'openai-local-api-key-abort',
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-local-openai-compatible-abort',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill(`Delay, then reply exactly: ${responseText}`);
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Stop', { timeout: 30_000 });
      await responseStarted.promise;
      await expect.poll(() => requests.some((request) => request.url?.includes('/responses')), {
        timeout: 10_000,
      }).toBe(true);

      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Send', { timeout: 60_000 });
      releaseCompletion.resolve();
      await Promise.race([
        responseClosed.promise,
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);

      await expect(
        page.getByTestId('chat-message-role-assistant').filter({ hasText: responseText }),
      ).toHaveCount(0, { timeout: 10_000 });
      await expect.poll(async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-status-after-local-openai-compatible-abort',
            module: 'gateway',
            action: 'status',
          });
        });
      }, { timeout: 60_000 }).toMatchObject({
        ok: true,
        data: expect.objectContaining({ state: 'running' }),
      });
    } finally {
      releaseCompletion.resolve();
      const page = await getStableWindow(app).catch(() => null);
      if (page) await stopRuntime(page);
      await closeElectronApp(app);
      await closeServer(server);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });

  test('sends a chat message through real cc-connect and Codex with an OpenAI API key', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    test.skip(process.env.CLAWX_REAL_OPENAI_API_KEY_E2E !== '1', 'Set CLAWX_REAL_OPENAI_API_KEY_E2E=1 to run with a real CLAWX_REAL_OPENAI_API_KEY or OPENAI_API_KEY.');
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    const apiKey = requiredOpenAiApiKey();
    const createdAt = new Date().toISOString();
    const model = process.env.CLAWX_REAL_OPENAI_MODEL?.trim() || 'gpt-5.5';
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-api-key': {
          id: 'openai-api-key',
          vendorId: 'openai',
          label: 'OpenAI API Key',
          authMode: 'api_key',
          model,
          enabled: true,
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        'openai-api-key': {
          type: 'api_key',
          accountId: 'openai-api-key',
          apiKey,
        },
      },
      apiKeys: {},
      defaultProviderAccountId: 'openai-api-key',
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-openai-api-key',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill('Reply exactly: CLAWX_REAL_OPENAI_API_KEY_OK');
      await page.getByTestId('chat-composer-send').click();
      await expectAssistantText(page, 'CLAWX_REAL_OPENAI_API_KEY_OK');

      const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
      expect(managedConfig).toContain('provider = "openai"');
      expect(managedConfig).toContain('api_key = "${OPENAI_API_KEY}"');
      expect(managedConfig).toContain(`model = "${model}"`);
      expect(managedConfig).not.toContain(apiKey);

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('OPENAI_API_KEY');
      expect(publicProfile).not.toContain(apiKey);
    } finally {
      const page = await getStableWindow(app).catch(() => null);
      if (page) await stopRuntime(page);
      await closeElectronApp(app);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });
});
