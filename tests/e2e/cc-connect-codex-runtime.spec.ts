import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
  await chmod(path, 0o755);
}

async function createMockCodexBinary(dir: string): Promise<string> {
  const binaryPath = join(dir, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  await mkdir(join(binaryPath, '..'), { recursive: true });
  await writeExecutable(binaryPath, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('codex-cli e2e-mock\\n');
  process.exit(0);
}
if (args[0] !== 'exec') {
  process.stderr.write('unexpected codex args: ' + JSON.stringify(args));
  process.exit(2);
}
if (process.env.CLAWX_E2E_CODEX_ARGS_PATH) {
  fs.writeFileSync(process.env.CLAWX_E2E_CODEX_ARGS_PATH, JSON.stringify(args, null, 2));
}
if (process.env.CLAWX_E2E_CODEX_ENV_PATH) {
  fs.writeFileSync(process.env.CLAWX_E2E_CODEX_ENV_PATH, JSON.stringify({
    CODEX_HOME: process.env.CODEX_HOME || null,
  }, null, 2));
}
const outputIndex = args.indexOf('--output-last-message');
if (outputIndex >= 0 && args[outputIndex + 1]) {
  fs.writeFileSync(args[outputIndex + 1], 'Codex E2E response from mock binary');
}
process.stdout.write(JSON.stringify({ item: { role: 'assistant', content: [{ type: 'text', text: 'Codex E2E response from stdout' }] } }) + '\\n');
process.exit(0);
`);
  return binaryPath;
}

async function createMockCcConnectBinary(dir: string): Promise<string> {
  const binaryPath = join(dir, process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect');
  await mkdir(dir, { recursive: true });
  await writeExecutable(binaryPath, `#!/usr/bin/env node
const http = require('node:http');
const WebSocket = require('ws');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('cc-connect v1.3.2 e2e-mock\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write('cc-connect doctor e2e ok\\n');
  process.exit(0);
}
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/api/v1/status')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url && req.url.startsWith('/api/v1/cron')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jobs: [] }));
    return;
  }
  res.writeHead(404);
  res.end('{}');
});
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith('/bridge/ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'register') {
      ws.send(JSON.stringify({ type: 'register_ack', ok: true }));
      return;
    }
    if (msg.type === 'message') {
      ws.send(JSON.stringify({
        type: 'reply',
        reply_ctx: msg.reply_ctx,
        content: 'cc-connect bridge E2E response',
      }));
    }
  });
});
server.listen(9810, '127.0.0.1');
process.stdout.write('cc-connect bridge e2e mock ready\\n');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`);
  return binaryPath;
}

async function prepareMockBundles(userDataDir: string): Promise<void> {
  const target = `${process.platform}-${process.arch}`;
  await rm(join(process.cwd(), 'build', 'codex', target), { recursive: true, force: true });
  await rm(join(process.cwd(), 'build', 'cc-connect', target), { recursive: true, force: true });
  await createMockCodexBinary(join(process.cwd(), 'build', 'codex', target));
  await createMockCcConnectBinary(join(process.cwd(), 'build', 'cc-connect', target));
  await writeFile(join(userDataDir, 'codex-bundle-ready'), 'ok', 'utf8');
}

test.describe('cc-connect + Codex runtime E2E', () => {
  test.skip(process.platform === 'win32', 'POSIX executable mock binaries are used in this E2E');

  test('starts cc-connect runtime, writes managed config, and sends chat through Codex bridge', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    await prepareMockBundles(userDataDir);

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'ollama-local': {
          id: 'ollama-local',
          vendorId: 'ollama',
          label: 'Ollama Local',
          authMode: 'local',
          model: 'qwen3:latest',
          enabled: true,
          isDefault: true,
          createdAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:00.000Z',
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: 'ollama-local',
    }, null, 2), 'utf8');
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CODEX_WORKDIR: process.cwd(),
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const status = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status',
          module: 'gateway',
          action: 'status',
        });
      });
      expect(status).toMatchObject({
        ok: true,
        data: {
          state: 'running',
          runtimeKind: 'cc-connect',
          capabilities: expect.objectContaining({
            chat: true,
            sessions: true,
            history: true,
            doctor: true,
            providers: true,
            models: true,
          }),
        },
      });

      const managedConfig = join(userDataDir, 'runtimes', 'cc-connect', 'config.toml');
      await expect.poll(async () => await readFile(managedConfig, 'utf8')).toContain('path = "/bridge/ws"');
      await expect.poll(async () => await readFile(managedConfig, 'utf8')).toContain('cmd = "');

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('hello codex runtime');
      await page.getByTestId('chat-composer-send').click();

      const readHistory = async () => await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: `runtime-history-${Date.now()}`,
          module: 'sessions',
          action: 'history',
          payload: { sessionKey: 'agent:main:main', limit: 20 },
        });
      });
      await expect.poll(async () => readHistory(), { timeout: 30_000 }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'hello codex runtime' }),
            expect.objectContaining({ role: 'assistant', content: 'cc-connect bridge E2E response' }),
          ]),
        },
      });

      await expect(page.getByText('cc-connect bridge E2E response')).toBeVisible({ timeout: 30_000 });

      const history = await readHistory();
      expect(history).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'hello codex runtime' }),
            expect.objectContaining({ role: 'assistant', content: 'cc-connect bridge E2E response' }),
          ]),
        },
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts cc-connect runtime with OpenAI OAuth Codex auth in a managed CODEX_HOME', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    await prepareMockBundles(userDataDir);
    const createdAt = '2026-06-07T00:00:00.000Z';

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-oauth': {
          id: 'openai-oauth',
          vendorId: 'openai',
          label: 'OpenAI OAuth',
          authMode: 'oauth_browser',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
          metadata: { email: 'user@example.com', resourceUrl: 'openai-codex' },
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        'openai-oauth': {
          type: 'oauth',
          accountId: 'openai-oauth',
          accessToken: 'fake-access-token',
          refreshToken: 'fake-refresh-token',
          idToken: 'fake-id-token',
          expiresAt: 1_780_000_000_000,
          email: 'user@example.com',
          subject: 'acct_e2e',
        },
      },
      apiKeys: {},
      defaultProviderAccountId: 'openai-oauth',
    }, null, 2), 'utf8');
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CODEX_WORKDIR: process.cwd(),
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-oauth',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('hello openai oauth codex runtime');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText('cc-connect bridge E2E response')).toBeVisible({ timeout: 30_000 });

      const managedCodexHome = join(userDataDir, 'runtimes', 'cc-connect', 'codex-home');

      const authJson = JSON.parse(await readFile(join(managedCodexHome, 'auth.json'), 'utf8'));
      expect(authJson).toMatchObject({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: 'fake-id-token',
          access_token: 'fake-access-token',
          refresh_token: 'fake-refresh-token',
          account_id: 'acct_e2e',
        },
      });

      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain('fake-access-token');
      expect(publicProfile).not.toContain('fake-refresh-token');
      expect(publicProfile).not.toContain('fake-id-token');
    } finally {
      await closeElectronApp(app);
    }
  });
});
