import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
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

function writeFunctionCallStream(
  res: ServerResponse,
  model: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const { response } = responseStreamParts('', model);
  const argumentsJson = JSON.stringify(args);
  const item = {
    id: 'call_clawx_local_skill',
    call_id: 'call_clawx_local_skill',
    type: 'function_call',
    status: 'in_progress',
    name,
    arguments: '',
  };
  const doneItem = { ...item, status: 'completed', arguments: argumentsJson };
  writeSse(res, 'response.created', { response });
  writeSse(res, 'response.in_progress', { response });
  writeSse(res, 'response.output_item.added', { output_index: 0, item });
  writeSse(res, 'response.function_call_arguments.delta', {
    item_id: item.id,
    output_index: 0,
    delta: argumentsJson,
  });
  writeSse(res, 'response.function_call_arguments.done', {
    item_id: item.id,
    output_index: 0,
    arguments: argumentsJson,
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

function createOpenAiCompatibleServer(options: {
  expectedApiKey: string;
  model: string;
  responseText: string;
  requests: OpenAiCompatibleRequest[];
  delayCompletion?: boolean;
  responseStarted?: Deferred<void>;
  releaseCompletion?: Promise<void>;
  responseClosed?: Deferred<void>;
  skillTool?: {
    promptToken: string;
    outputMarker: string;
    command: string;
  };
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
    if (
      options.skillTool
      && body.includes(options.skillTool.promptToken)
      && !body.includes(options.skillTool.outputMarker)
    ) {
      writeFunctionCallStream(res, options.model, 'exec_command', {
        cmd: options.skillTool.command,
        yield_time_ms: 10_000,
        max_output_chars: 20_000,
      });
      return;
    }
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
  test.fixme('reports per-turn usage through a public cc-connect runtime API', async () => {
    // cc-connect v1.4.1 does not expose token usage over Bridge or Management API.
  });

  test('sends a chat message through real cc-connect and Codex with a local OpenAI-compatible API key server', async ({
    launchElectronApp,
    homeDir,
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
    const skillMarker = 'CLAWX_CC_CONNECT_SKILL_BODY_MARKER_20260711';
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');
    const accountSkillPath = join(
      userDataDir,
      'credentials',
      'oauth',
      'openai-local-api-key',
      'codex-home',
      'skills',
      'clawx-local-proof',
      'SKILL.md',
    );
    const requests: OpenAiCompatibleRequest[] = [];
    const server = createOpenAiCompatibleServer({
      expectedApiKey: apiKey,
      model,
      responseText,
      requests,
      skillTool: {
        promptToken: '$clawx-local-proof',
        outputMarker: skillMarker,
        command: `sed -n '1,80p' ${JSON.stringify(accountSkillPath)}`,
      },
    });
    const port = await listen(server);
    const shortDataRoot = join(process.platform === 'win32' ? tmpdir() : '/tmp', `cx-${process.pid}-${Date.now().toString(36)}`);
    await symlink(userDataDir, shortDataRoot, process.platform === 'win32' ? 'junction' : 'dir');

    const skillDir = join(homeDir, '.openclaw', 'skills', 'clawx-local-proof');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: clawx-local-proof',
      'description: Proves that cc-connect launched Codex discovers ClawX managed skills.',
      '---',
      '',
      `When invoked, include this instruction marker in the active context: ${skillMarker}`,
      '',
    ].join('\n'), 'utf8');

    const appConfigDir = join(userDataDir, 'app');
    await mkdir(appConfigDir, { recursive: true });
    await writeFile(join(appConfigDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(appConfigDir, 'clawx-providers.json'), JSON.stringify({
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
        CLAWX_DATA_HOME: shortDataRoot,
        CLAWX_USER_DATA_DIR: join(shortDataRoot, 'system', 'electron'),
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

      await expect(readFile(accountSkillPath, 'utf8')).resolves.toContain(skillMarker);
      await page.getByTestId('chat-composer-input').fill('$clawx-local-proof verify the managed skill');
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(() => requests.filter((request) => request.url?.includes('/responses')).length, {
        timeout: 30_000,
      }).toBeGreaterThan(1);
      const responseBodies = requests
        .filter((request) => request.url?.includes('/responses'))
        .map((request) => request.body ?? '');
      const skillCatalogBody = responseBodies.find((body) => body.includes('clawx-local-proof')) ?? '';
      expect(skillCatalogBody).toContain('credentials/oauth/openai-local-api-key/codex-home/skills/clawx-local-proof/SKILL.md');
      expect(skillCatalogBody.match(/- clawx-local-proof:/g)).toHaveLength(1);
      await expect.poll(() => responseBodies.concat(
        requests.filter((request) => request.url?.includes('/responses')).map((request) => request.body ?? ''),
      ).some((body) => body.includes(skillMarker)), {
        timeout: 30_000,
        intervals: [250, 500, 1_000, 2_000],
        message: 'Codex should execute the skill read and return its body marker to the model',
      }).toBe(true);
      await expect(page.getByTestId('chat-message-role-assistant').filter({ hasText: responseText }))
        .toHaveCount(2, { timeout: 30_000 });

      const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
      const managedMainWorkspace = join(shortDataRoot, 'workspaces', 'agents', 'main');
      expect(managedConfig).toContain('provider = "clawx-openai"');
      expect(managedConfig).toContain('api_key = "${CLAWX_CODEX_OPENAI_LOCAL_API_KEY_API_KEY}"');
      expect(managedConfig).toContain(`base_url = "http://127.0.0.1:${port}/v1"`);
      expect(managedConfig).toContain(`model = "${model}"`);
      expect(managedConfig).toContain(`work_dir = "${managedMainWorkspace}"`);
      expect(managedConfig).not.toContain(`work_dir = "${process.cwd()}"`);
      expect(managedConfig).not.toContain(apiKey);
      await expect(access(managedMainWorkspace)).resolves.toBeUndefined();

      const publicProviderStore = await readFile(join(appConfigDir, 'clawx-providers.json'), 'utf8');
      expect(publicProviderStore).toContain('openai-local-api-key');
      expect(publicProviderStore).not.toContain(apiKey);
      const encryptedVault = await readFile(join(userDataDir, 'credentials', 'secrets.enc'));
      expect(encryptedVault.includes(Buffer.from(apiKey, 'utf8'))).toBe(false);
      const credentialIndex = await readFile(join(userDataDir, 'credentials', 'index.json'), 'utf8');
      expect(credentialIndex).toContain('openai-local-api-key');
      expect(credentialIndex).not.toContain(apiKey);

      const codexConfig = await readFile(join(userDataDir, 'credentials', 'oauth', 'openai-local-api-key', 'codex-home', 'config.toml'), 'utf8');
      expect(codexConfig).toContain('model_provider = "clawx-openai"');
      expect(codexConfig).toContain(`base_url = "http://127.0.0.1:${port}/v1"`);
      expect(codexConfig).toContain('env_key = "OPENAI_API_KEY"');
      expect(codexConfig).not.toContain(apiKey);

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CLAWX_CODEX_OPENAI_LOCAL_API_KEY_API_KEY');
      expect(publicProfile).toContain('clawx-openai');
      expect(publicProfile).not.toContain(apiKey);

      const launcher = await readFile(join(runtimeDir, 'config', 'launchers', 'codex-openai-local-api-key'), 'utf8');
      expect(launcher).toContain('export OPENAI_API_KEY="${CLAWX_CODEX_OPENAI_LOCAL_API_KEY_API_KEY}"');
      expect(launcher).not.toContain(apiKey);

      const channelCronPrompt = 'CLAWX_BRIDGE_NATIVE_CRON_PROMPT';
      await page.getByTestId('chat-composer-input').fill(`/cron add 0 0 1 1 * ${channelCronPrompt}`);
      await page.getByTestId('chat-composer-send').click();
      const listCron = async () => await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-cron-list-after-bridge-command',
        module: 'cron',
        action: 'list',
      }));
      await expect.poll(listCron, {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
      }).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            message: channelCronPrompt,
            agentId: 'main',
            enabled: true,
          }),
        ]),
      });
      const cronListResult = await listCron() as { data?: Array<{ id?: string; message?: string }> };
      const bridgeCronId = cronListResult.data?.find((job) => job.message === channelCronPrompt)?.id;
      expect(bridgeCronId).toBeTruthy();
      const toggleCronResult = await page.evaluate(async (id) => window.clawx.hostInvoke({
        id: 'runtime-cron-toggle-bridge-created-job',
        module: 'cron',
        action: 'toggle',
        payload: { id, enabled: false },
      }), bridgeCronId);
      expect(toggleCronResult).toMatchObject({
        ok: true,
        data: { id: bridgeCronId, enabled: false },
      });
      await expect.poll(listCron).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ id: bridgeCronId, enabled: false }),
        ]),
      });
      const deleteCronResult = await page.evaluate(async (id) => window.clawx.hostInvoke({
        id: 'runtime-cron-delete-bridge-created-job',
        module: 'cron',
        action: 'delete',
        payload: { id },
      }), bridgeCronId);
      expect(deleteCronResult).toMatchObject({ ok: true, data: { success: true } });
      await expect.poll(async () => {
        const result = await listCron() as { data?: Array<{ id?: string }> };
        return result.data?.some((job) => job.id === bridgeCronId) ?? false;
      }).toBe(false);

      const readSessions = async () => await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-sessions-local-openai-compatible',
        module: 'sessions',
        action: 'summaries',
        payload: {},
      }));
      await expect.poll(readSessions, {
        timeout: 30_000,
        intervals: [500, 1_000, 2_000],
      }).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({ key: 'agent:main:main' }),
          ]),
        },
      });

      const historyResult = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-history-local-openai-compatible',
        module: 'sessions',
        action: 'history',
        payload: { sessionKey: 'agent:main:main', limit: 20 },
      }));
      expect(historyResult).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: `Reply exactly: ${responseText}` }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        },
      });

      const mediaFixtureDir = join(managedMainWorkspace, 'cc-connect-cli-media');
      const imagePath = join(mediaFixtureDir, 'real-bridge-image.png');
      const filePath = join(mediaFixtureDir, 'real-bridge-report.pdf');
      const audioPath = join(mediaFixtureDir, 'real-bridge-audio.wav');
      const videoPath = join(mediaFixtureDir, 'real-bridge-video.mp4');
      const imageBytes = await readFile(join(process.cwd(), 'src', 'assets', 'community', '20260212-185822.png'));
      const fileBytes = Buffer.from('%PDF-1.4\n% CLAWX_REAL_CC_CONNECT_FILE\n', 'utf8');
      const audioBytes = Buffer.from('RIFF0000WAVEfmt CLAWX_REAL_CC_CONNECT_AUDIO', 'utf8');
      const videoBytes = Buffer.from('0000ftypisomCLAWX_REAL_CC_CONNECT_VIDEO', 'utf8');
      await mkdir(mediaFixtureDir, { recursive: true });
      await Promise.all([
        writeFile(imagePath, imageBytes),
        writeFile(filePath, fileBytes),
        writeFile(audioPath, audioBytes),
        writeFile(videoPath, videoBytes),
      ]);
      const managedDataDir = managedConfig.match(/^data_dir\s*=\s*"([^"]+)"/m)?.[1]?.replace(/\\\\/g, '\\');
      expect(managedDataDir).toBeTruthy();
      await expect.poll(async () => {
        try {
          await access(join(managedDataDir!, 'run', 'api.sock'));
          return true;
        } catch {
          return false;
        }
      }, {
        timeout: 10_000,
        intervals: [100, 250, 500],
        message: 'cc-connect local send API socket should be ready',
      }).toBe(true);
      const mediaMarker = 'CLAWX_REAL_CC_CONNECT_CLI_MEDIA';
      const mediaCli = await execFileAsync(bundles!.ccConnectPath, [
        'send',
        '--data-dir', managedDataDir!,
        '--project', 'clawx-main',
        '--session', 'clawx:main:main',
        '--message', mediaMarker,
        '--image', imagePath,
        '--file', filePath,
        '--audio', audioPath,
        '--video', videoPath,
      ], {
        env: { ...process.env, HOME: homeDir },
        timeout: 15_000,
      });
      expect(mediaCli.stdout).toContain('Message sent successfully.');
      expect(mediaCli.stderr).toBe('');
      const expectedMedia = [
        { fileName: 'real-bridge-image.png', mimeType: 'image/png', bytes: imageBytes },
        { fileName: 'real-bridge-report.pdf', mimeType: 'application/pdf', bytes: fileBytes },
        { fileName: 'audio.wav', mimeType: 'audio/wav', bytes: audioBytes },
        { fileName: 'real-bridge-video.mp4', mimeType: 'video/mp4', bytes: videoBytes },
      ];
      const readMediaHistory = async () => await page.evaluate(async () => window.clawx.hostInvoke({
        id: `runtime-real-cli-media-history-${Date.now()}`,
        module: 'sessions',
        action: 'history',
        payload: { sessionKey: 'agent:main:main', limit: 50 },
      })) as {
        data?: {
          messages?: Array<{
            content?: unknown;
            _attachedFiles?: Array<{
              fileName?: string;
              mimeType?: string;
              fileSize?: number;
              filePath?: string;
              preview?: string | null;
            }>;
          }>;
        };
      };
      await expect.poll(async () => {
        const history = await readMediaHistory();
        return (history.data?.messages ?? []).flatMap((message) => message._attachedFiles ?? []).map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
        }));
      }, {
        timeout: 10_000,
        intervals: [100, 250, 500],
      }).toEqual(expect.arrayContaining(expectedMedia.map(({ fileName, mimeType }) => ({ fileName, mimeType }))));
      const mediaHistory = await readMediaHistory();
      const attachedMedia = (mediaHistory.data?.messages ?? []).flatMap((message) => message._attachedFiles ?? []);
      for (const expected of expectedMedia) {
        const attachment = attachedMedia.find((candidate) => candidate.fileName === expected.fileName);
        expect(attachment).toMatchObject({
          fileName: expected.fileName,
          mimeType: expected.mimeType,
          fileSize: expected.bytes.byteLength,
          filePath: expect.stringContaining(join('runtimes', 'cc-connect', 'media', 'outgoing', 'bridge')),
        });
        await expect(readFile(attachment!.filePath!)).resolves.toEqual(expected.bytes);
      }
      expect(attachedMedia.find((attachment) => attachment.fileName === 'real-bridge-image.png')?.preview)
        .toMatch(/^data:image\/png;base64,/);
      await expect(page.getByRole('img', { name: 'real-bridge-image.png' }).last())
        .toBeVisible({ timeout: 10_000 });
      for (const expected of expectedMedia.filter(({ mimeType }) => !mimeType.startsWith('image/'))) {
        await expect(page.getByText(expected.fileName, { exact: true }).last())
          .toBeVisible({ timeout: 10_000 });
      }
      const evidenceDir = join(process.cwd(), 'artifacts', 'cc-connect');
      await mkdir(evidenceDir, { recursive: true });
      await page.evaluate(() => {
        document.body.style.zoom = '0.45';
        const scrollContainer = document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]');
        const imagePreview = document.querySelector<HTMLImageElement>('img[alt="real-bridge-image.png"]');
        if (imagePreview) {
          imagePreview.style.width = '160px';
          imagePreview.style.maxHeight = '160px';
          imagePreview.style.objectFit = 'contain';
        }
        const mediaNames = ['real-bridge-image.png', 'real-bridge-report.pdf', 'audio.wav', 'real-bridge-video.mp4'];
        const firstMediaMessage = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="chat-message-"]'))
          .find((element) => mediaNames.some((name) => (
            element.textContent?.includes(name) || element.querySelector(`img[alt="${name}"]`)
          )));
        if (scrollContainer && firstMediaMessage) {
          scrollContainer.scrollTop += firstMediaMessage.getBoundingClientRect().top
            - scrollContainer.getBoundingClientRect().top;
        }
      });
      await page.getByTestId('chat-scroll-container')
        .screenshot({ path: join(evidenceDir, 'real-cli-media-bridge.png') });
      await writeFile(join(evidenceDir, 'real-cli-media-bridge.json'), `${JSON.stringify({
        schema: 'clawx-cc-connect-real-cli-media-evidence',
        version: 1,
        runtimeKind: 'cc-connect',
        source: 'bundled-cc-connect-send-cli',
        publicBridgeProtocol: true,
        cliAcknowledged: true,
        bridgeMediaKinds: ['image', 'file', 'audio', 'video'],
        hostHistoryObserved: true,
        guiAttachmentsObserved: true,
        managedMediaCopiesObserved: true,
        imagePreviewObserved: true,
        screenshot: 'artifacts/cc-connect/real-cli-media-bridge.png',
      }, null, 2)}\n`, 'utf8');

      const renameResult = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-session-rename-local-openai-compatible',
        module: 'sessions',
        action: 'rename',
        payload: { sessionKey: 'agent:main:main', label: 'Local API session' },
      }));
      expect(renameResult).toMatchObject({ ok: true, data: { success: true } });
      await expect.poll(readSessions).toMatchObject({
        data: {
          sessions: expect.arrayContaining([
            expect.objectContaining({ key: 'agent:main:main', displayName: 'Local API session' }),
          ]),
        },
      });
      const sessionMetadataPath = join(appConfigDir, 'cc-connect-session-metadata.json');
      const renamedSessionMetadata = await readFile(sessionMetadataPath, 'utf8');
      expect(renamedSessionMetadata).toContain('"agent:main:main": "Local API session"');
      await expect(access(join(runtimeDir, 'data', 'sessions', '.clawx-supplemental-history.json'))).rejects.toThrow();

      const deleteResult = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-session-delete-local-openai-compatible',
        module: 'sessions',
        action: 'delete',
        payload: { sessionKey: 'agent:main:main' },
      }));
      expect(deleteResult).toMatchObject({ ok: true, data: { success: true } });
      await expect.poll(async () => {
        const result = await readSessions() as { data?: { sessions?: Array<{ key?: string }> } };
        return result.data?.sessions?.some((session) => session.key === 'agent:main:main') ?? false;
      }).toBe(false);
      await expect(readFile(sessionMetadataPath, 'utf8')).resolves.not.toContain('agent:main:main');
    } finally {
      const page = await getStableWindow(app).catch(() => null);
      if (page) await stopRuntime(page);
      await closeElectronApp(app);
      await closeServer(server);
      await waitForNoRuntimeProcesses(join(shortDataRoot, 'runtimes', 'cc-connect'));
      await rm(shortDataRoot, { force: true });
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

      const statusBeforeAbort = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-before-local-openai-compatible-abort',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok?: boolean; data?: { state?: string; pid?: number } };
      expect(statusBeforeAbort).toMatchObject({
        ok: true,
        data: expect.objectContaining({ state: 'running', pid: expect.any(Number) }),
      });
      const runtimePid = statusBeforeAbort.data?.pid;

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
      const upstreamClosedByAbort = await Promise.race([
        responseClosed.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
      ]);
      expect(upstreamClosedByAbort).toBe(true);
      releaseCompletion.resolve();

      await expect(
        page.getByTestId('chat-message-role-assistant').filter({ hasText: responseText }),
      ).toHaveCount(0, { timeout: 10_000 });
      const readRuntimeStatus = async () => {
        return await page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-status-after-local-openai-compatible-abort',
            module: 'gateway',
            action: 'status',
          });
        });
      };
      await expect.poll(readRuntimeStatus, { timeout: 60_000 }).toMatchObject({
        ok: true,
        data: expect.objectContaining({ state: 'running', pid: runtimePid }),
      });
      const statusAfterAbort = await readRuntimeStatus() as {
        ok?: boolean;
        data?: { state?: string; pid?: number; runtimeKind?: string };
      };
      const lateAssistantCount = await page.getByTestId('chat-message-role-assistant')
        .filter({ hasText: responseText })
        .count();
      const evidenceDir = join(process.cwd(), 'artifacts', 'cc-connect');
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(evidenceDir, 'real-local-chat-abort.png'),
        fullPage: true,
      });
      await writeFile(join(evidenceDir, 'real-local-chat-abort.json'), JSON.stringify({
        runtimeKind: statusAfterAbort.data?.runtimeKind || 'cc-connect',
        transport: 'BridgePlatform /stop',
        upstreamClosedByAbort,
        runtimePidBefore: runtimePid,
        runtimePidAfter: statusAfterAbort.data?.pid,
        runtimePidUnchanged: statusAfterAbort.data?.pid === runtimePid,
        lateAssistantCount,
        runtimeStateAfter: statusAfterAbort.data?.state,
      }, null, 2), 'utf8');
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
      expect(managedConfig).toContain('api_key = "${CLAWX_CODEX_OPENAI_API_KEY_API_KEY}"');
      expect(managedConfig).toContain(`model = "${model}"`);
      expect(managedConfig).not.toContain(apiKey);

      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CLAWX_CODEX_OPENAI_API_KEY_API_KEY');
      expect(publicProfile).not.toContain(apiKey);
    } finally {
      const page = await getStableWindow(app).catch(() => null);
      if (page) await stopRuntime(page);
      await closeElectronApp(app);
      await waitForNoRuntimeProcesses(runtimeDir);
    }
  });
});
