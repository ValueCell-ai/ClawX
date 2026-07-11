import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
  await chmod(path, 0o755);
}

async function waitForPortClosed(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for TCP port ${port} to close`);
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
process.stdout.write(JSON.stringify({
  type: 'response_item',
  payload: {
    type: 'function_call',
    call_id: 'call_exec_e2e',
    name: 'exec_command',
    arguments: JSON.stringify({ cmd: 'pwd && ls -1' }),
  },
}) + '\\n');
process.stdout.write(JSON.stringify({
  type: 'response_item',
  payload: {
    type: 'function_call_output',
    call_id: 'call_exec_e2e',
    output: 'package.json\\nsrc\\n',
  },
}) + '\\n');
process.stdout.write(JSON.stringify({ item: { role: 'assistant', content: [{ type: 'text', text: 'Codex E2E response from stdout' }] } }) + '\\n');
process.exit(0);
`);
  return binaryPath;
}

async function createMockCcConnectBinary(dir: string): Promise<string> {
  const binaryPath = join(dir, process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect');
  const wsModulePath = require.resolve('ws');
  await mkdir(dir, { recursive: true });
  await writeExecutable(binaryPath, `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require(${JSON.stringify(wsModulePath)});
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('cc-connect v1.3.2 e2e-mock\\n');
  process.exit(0);
}
if (args[0] === 'doctor') {
  process.stdout.write('cc-connect doctor e2e ok\\n');
  process.exit(0);
}
if (process.env.CLAWX_E2E_CC_CONNECT_ENV_PATH) {
  fs.writeFileSync(process.env.CLAWX_E2E_CC_CONNECT_ENV_PATH, JSON.stringify({
    CLAWX_CODEX_OPENAI_MAIN_API_KEY: process.env.CLAWX_CODEX_OPENAI_MAIN_API_KEY || null,
    CODEX_HOME: process.env.CODEX_HOME || null,
  }, null, 2));
}
let bridgePort = 9810;
let managementPort = 9820;
const configIndex = args.indexOf('-config');
if (configIndex >= 0 && args[configIndex + 1]) {
  try {
    const config = fs.readFileSync(args[configIndex + 1], 'utf8');
    let section = '';
    for (const rawLine of config.split('\\n')) {
      const line = rawLine.trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1);
        continue;
      }
      if (!line.startsWith('port =')) continue;
      const value = Number(line.split('=')[1].trim().replace(/"/g, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      if (section === 'bridge') bridgePort = value;
      if (section === 'management') managementPort = value;
    }
  } catch {
    // Keep defaults when the mock is started without a readable config.
  }
}
let cronSeq = 0;
let jobs = [];
const sessionsByProject = new Map();
const deletedSessionIds = new Set();
const pendingApprovals = new Map();
function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({});
      }
    });
  });
}
function writeBridgeMessage(message) {
  if (!process.env.CLAWX_E2E_CC_CONNECT_MESSAGES_PATH) return;
  fs.appendFileSync(process.env.CLAWX_E2E_CC_CONNECT_MESSAGES_PATH, JSON.stringify(message) + '\\n');
}
function fixtureSessions() {
  const path = process.env.CLAWX_E2E_CC_CONNECT_SESSION_FIXTURE_PATH;
  if (!path) return [];
  try {
    const value = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function projectSessions(project) {
  return [...(sessionsByProject.get(project) || []), ...fixtureSessions().filter((item) => item.project === project)]
    .filter((item) => !deletedSessionIds.has(item.id));
}
function storeBridgeSession(message, assistantText) {
  const project = message.project || 'clawx-main';
  const sessionKey = message.session_key || 'clawx:main:main';
  const sessions = sessionsByProject.get(project) || [];
  let session = sessions.find((item) => item.session_key === sessionKey);
  const now = Date.now();
  if (!session) {
    session = {
      id: 'session-' + Buffer.from(project + ':' + sessionKey).toString('hex').slice(0, 24),
      project,
      session_key: sessionKey,
      name: sessionKey,
      active: true,
      created_at: now,
      updated_at: now,
      history: [],
    };
    sessions.push(session);
    sessionsByProject.set(project, sessions);
  }
  session.history.push(
    { id: 'user-' + now, role: 'user', content: message.content || '', timestamp: now },
    { id: 'assistant-' + now, role: 'assistant', content: assistantText, timestamp: now + 1 },
  );
  session.updated_at = now + 1;
  session.last_message = session.history[session.history.length - 1];
}
const handleHttpRequest = async (req, res) => {
  if (req.url && req.url.startsWith('/api/v1/status')) {
    json(res, 200, { ok: true });
    return;
  }
  if (req.url && req.url.startsWith('/api/v1/projects/')) {
    const url = new URL(req.url, 'http://127.0.0.1:' + managementPort);
    const parts = url.pathname.split('/').filter(Boolean);
    const project = decodeURIComponent(parts[3] || 'clawx-main');
    if (parts.length === 4 && req.method === 'GET') {
      json(res, 200, { name: project, platforms: [] });
      return;
    }
    if (parts[4] === 'sessions' && parts.length === 5 && req.method === 'GET') {
      json(res, 200, { sessions: projectSessions(project).map((session) => ({
        id: session.id,
        session_key: session.session_key,
        name: session.name,
        user_name: session.user_name,
        chat_name: session.chat_name,
        active: session.active !== false,
        created_at: session.created_at,
        updated_at: session.updated_at,
        last_message: session.last_message,
      })) });
      return;
    }
    if (parts[4] === 'sessions' && parts.length === 6) {
      const id = decodeURIComponent(parts[5]);
      const session = projectSessions(project).find((candidate) => candidate.id === id);
      if (!session) {
        json(res, 404, { error: 'session not found' });
        return;
      }
      if (req.method === 'GET') {
        json(res, 200, { ...session, history: session.history || [] });
        return;
      }
      if (req.method === 'DELETE') {
        deletedSessionIds.add(id);
        json(res, 200, { success: true });
        return;
      }
    }
  }
  if (req.url && req.url.startsWith('/api/v1/cron')) {
    const url = new URL(req.url, 'http://127.0.0.1:' + managementPort);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[3];
    if (req.method === 'GET' && parts.length === 3) {
      const project = url.searchParams.get('project');
      json(res, 200, { jobs: project ? jobs.filter((job) => job.project === project) : jobs });
      return;
    }
    if (req.method === 'POST' && parts.length === 3) {
      const body = await readBody(req);
      const now = new Date().toISOString();
      const job = {
        id: 'cron-e2e-' + (++cronSeq),
        description: body.description || 'Scheduled task',
        prompt: body.prompt || '',
        cron_expr: body.cron_expr || '0 9 * * *',
        enabled: body.enabled !== false,
        silent: body.silent !== false,
        project: body.project || 'clawx-main',
        session_key: body.session_key || 'clawx:main:main',
        created_at: now,
        updated_at: now,
      };
      jobs.push(job);
      json(res, 200, { job });
      return;
    }
    const index = jobs.findIndex((job) => job.id === id);
    if (!id || index < 0) {
      json(res, 404, { error: 'cron not found' });
      return;
    }
    if (req.method === 'PATCH' && parts.length === 4) {
      const body = await readBody(req);
      jobs[index] = { ...jobs[index], ...body, updated_at: new Date().toISOString() };
      json(res, 200, { job: jobs[index] });
      return;
    }
    if (req.method === 'DELETE' && parts.length === 4) {
      jobs.splice(index, 1);
      json(res, 200, { success: true });
      return;
    }
    if (req.method === 'POST' && parts.length === 5 && parts[4] === 'exec') {
      jobs[index] = { ...jobs[index], last_run_at: new Date().toISOString(), last_status: 'ok' };
      json(res, 200, { success: true });
      return;
    }
    json(res, 405, { error: 'unsupported cron method' });
    return;
  }
  json(res, 404, {});
};
const bridgeServer = http.createServer(handleHttpRequest);
const managementServer = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ noServer: true });
bridgeServer.on('upgrade', (req, socket, head) => {
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
      writeBridgeMessage(msg);
      if (String(msg.content || '').includes('require approval')) {
        pendingApprovals.set(msg.reply_ctx, msg);
        ws.send(JSON.stringify({
          type: 'buttons',
          session_key: msg.session_key,
          reply_ctx: msg.reply_ctx,
          project: msg.project,
          content: 'Allow Codex to run the requested command?',
          buttons: [[
            { Text: 'Allow once', Data: 'perm:allow' },
            { Text: 'Deny', Data: 'perm:deny' },
          ]],
        }));
        return;
      }
      storeBridgeSession(msg, 'cc-connect bridge E2E response');
      ws.send(JSON.stringify({
        type: 'reply',
        reply_ctx: msg.reply_ctx,
        content: 'cc-connect bridge E2E response',
      }));
      return;
    }
    if (msg.type === 'card_action') {
      writeBridgeMessage(msg);
      const original = pendingApprovals.get(msg.reply_ctx);
      if (!original) return;
      const response = msg.action === 'perm:deny'
        ? 'cc-connect approval denied'
        : 'cc-connect approval accepted';
      storeBridgeSession(original, response);
      pendingApprovals.delete(msg.reply_ctx);
      ws.send(JSON.stringify({
        type: 'reply',
        session_key: msg.session_key,
        reply_ctx: msg.reply_ctx,
        content: response,
      }));
    }
  });
});
bridgeServer.listen(bridgePort, '127.0.0.1');
managementServer.listen(managementPort, '127.0.0.1');
process.stdout.write('cc-connect bridge e2e mock ready\\n');
function shutdown() {
  let remaining = 2;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) process.exit(0);
  };
  bridgeServer.close(done);
  managementServer.close(done);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`);
  return binaryPath;
}

async function prepareMockBundles(userDataDir: string): Promise<{ ccConnectPath: string; codexPath: string }> {
  await Promise.all([
    waitForPortClosed(9810),
    waitForPortClosed(9820),
  ]);
  const mockBundleDir = join(userDataDir, 'mock-runtime-bundles');
  const codexPath = await createMockCodexBinary(join(mockBundleDir, 'codex'));
  const ccConnectPath = await createMockCcConnectBinary(join(mockBundleDir, 'cc-connect'));
  await writeFile(join(userDataDir, 'codex-bundle-ready'), 'ok', 'utf8');
  return { ccConnectPath, codexPath };
}

async function writeMockCcConnectChannelSession(userDataDir: string): Promise<void> {
  const createdAt = Date.now() - 60_000;
  const updatedAt = createdAt + 1_000;
  await writeFile(join(userDataDir, 'cc-connect-session-fixtures.json'), JSON.stringify([
    {
      project: 'clawx-support',
      id: 'session-support-1',
      session_key: 'clawx:support:member-1',
      name: 'Support Channel',
      chat_name: 'Support Channel',
      user_name: 'Member One',
      active: true,
      created_at: createdAt,
      updated_at: updatedAt,
      last_message: {
        id: 'support-assistant-1',
        role: 'assistant',
        content: 'reply synced from cc-connect channel',
        timestamp: updatedAt,
      },
      history: [
          {
            id: 'support-user-1',
            role: 'user',
            content: 'message from connected channel',
            timestamp: createdAt,
          },
          {
            id: 'support-assistant-1',
            role: 'assistant',
            content: 'reply synced from cc-connect channel',
            timestamp: updatedAt,
          },
        ],
    },
  ], null, 2), 'utf8');
}

test.describe('cc-connect + Codex runtime E2E', () => {
  test.skip(process.platform === 'win32', 'POSIX executable mock binaries are used in this E2E');

  test('starts cc-connect runtime, writes managed config, and sends chat through cc-connect BridgePlatform', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }, testInfo) => {
    const mockBundles = await prepareMockBundles(userDataDir);
    const bridgeMessagesPath = join(userDataDir, 'cc-connect-bridge-messages.jsonl');
    const openClawDir = join(homeDir, '.openclaw');
    await mkdir(openClawDir, { recursive: true });
    await writeFile(join(openClawDir, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'support', name: 'Support' },
          { id: 'analysis', name: 'Analysis' },
        ],
      },
    }, null, 2), 'utf8');

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
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
        CLAWX_CC_CONNECT_PATH: mockBundles.ccConnectPath,
        CLAWX_CODEX_PATH: mockBundles.codexPath,
        CLAWX_E2E_CC_CONNECT_MESSAGES_PATH: bridgeMessagesPath,
        CLAWX_E2E_CC_CONNECT_SESSION_FIXTURE_PATH: join(userDataDir, 'cc-connect-session-fixtures.json'),
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);

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
          operationCapabilities: expect.objectContaining({
            'chat.send': expect.objectContaining({ support: 'native' }),
            'chat.approval.respond': expect.objectContaining({ support: 'native' }),
            'chat.abort': expect.objectContaining({ support: 'native' }),
            'doctor.fix': expect.objectContaining({ support: 'unsupported' }),
          }),
        },
      });

      const managedConfig = join(userDataDir, 'runtimes', 'cc-connect', 'config.toml');
      await expect.poll(async () => await readFile(managedConfig, 'utf8')).toContain('path = "/bridge/ws"');
      await expect.poll(async () => await readFile(managedConfig, 'utf8')).toContain('cmd = "');
      await expect.poll(async () => await readFile(managedConfig, 'utf8')).toContain(
        `work_dir = "${join(userDataDir, 'workspaces', 'agents', 'main')}"`,
      );
      await expect.poll(async () => {
        const content = await readFile(managedConfig, 'utf8');
        return content.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      }).not.toContain(process.cwd());

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await page.getByTestId('agent-settings-main').click();
      await page.getByTestId('agent-runtime-settings-main').click();
      await expect(page.getByTestId('agent-cc-connect-permission-mode')).toBeVisible();
      await page.getByTestId('agent-permission-mode-suggest').click();
      await expect(page.getByTestId('agent-permission-mode-suggest')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('agent-runtime-settings-save')).toBeEnabled();
      await page.getByTestId('agent-runtime-settings-save').click();
      await expect.poll(async () => await readFile(managedConfig, 'utf8'), { timeout: 30_000 })
        .toContain('mode = "suggest"');
      await page.getByTestId('agent-settings-close').click();
      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-page')).toBeVisible();

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
      const bridgeMessages = (await readFile(bridgeMessagesPath, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(bridgeMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          content: 'hello codex runtime',
          project: 'clawx-main',
          session_key: 'clawx:main:main',
        }),
      ]));

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

      await page.getByTestId('chat-composer-input').fill('please require approval before the command');
      await page.getByTestId('chat-composer-send').click();
      const allowApproval = page.getByTestId('chat-approval-action-perm:allow');
      await expect(allowApproval).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Allow Codex to run the requested command?')).toBeVisible();
      await testInfo.attach('cc-connect-approval-request', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await allowApproval.click();
      await expect(page.getByText('cc-connect approval accepted')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-approval-actions')).toHaveCount(0);

      const approvalBridgeMessages = (await readFile(bridgeMessagesPath, 'utf8'))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const approvalPacket = approvalBridgeMessages.find((message) => message.type === 'card_action');
      expect(approvalPacket).toMatchObject({
        type: 'card_action',
        session_key: 'clawx:main:main',
        project: 'clawx-main',
        action: 'perm:allow',
      });
      await testInfo.attach('cc-connect-approval-bridge-packet', {
        body: Buffer.from(JSON.stringify(approvalPacket, null, 2)),
        contentType: 'application/json',
      });

      await writeMockCcConnectChannelSession(userDataDir);

      const channelSessions = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-sessions',
          module: 'sessions',
          action: 'summaries',
          payload: {},
        });
      });
      expect(channelSessions).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              key: 'agent:support:member-1',
              displayName: 'Support Channel / Member One',
            }),
          ]),
        },
      });

      const channelHistory = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-history',
          module: 'sessions',
          action: 'history',
          payload: { sessionKey: 'agent:support:member-1', limit: 20 },
        });
      });
      expect(channelHistory).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'message from connected channel' }),
            expect.objectContaining({ role: 'assistant', content: 'reply synced from cc-connect channel' }),
          ]),
        },
      });

      const renameChannelSession = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-session-rename',
          module: 'sessions',
          action: 'rename',
          payload: {
            sessionKey: 'agent:support:member-1',
            title: 'Renamed support channel',
          },
        });
      });
      expect(renameChannelSession).toMatchObject({ ok: true, data: { success: true } });

      const renamedChannelSessions = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-sessions-after-rename',
          module: 'sessions',
          action: 'summaries',
          payload: {},
        });
      });
      expect(renamedChannelSessions).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.arrayContaining([
            expect.objectContaining({
              key: 'agent:support:member-1',
              displayName: 'Renamed support channel',
              derivedTitle: 'Renamed support channel',
            }),
          ]),
        },
      });

      const deleteChannelSession = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-session-delete',
          module: 'sessions',
          action: 'delete',
          payload: { sessionKey: 'agent:support:member-1' },
        });
      });
      expect(deleteChannelSession).toMatchObject({ ok: true, data: { success: true } });

      const [channelSessionsAfterDelete, channelHistoryAfterDelete] = await Promise.all([
        page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-channel-sessions-after-delete',
            module: 'sessions',
            action: 'summaries',
            payload: {},
          });
        }),
        page.evaluate(async () => {
          return await window.clawx.hostInvoke({
            id: 'runtime-channel-history-after-delete',
            module: 'sessions',
            action: 'history',
            payload: { sessionKey: 'agent:support:member-1', limit: 20 },
          });
        }),
      ]);
      expect(channelSessionsAfterDelete).toMatchObject({
        ok: true,
        data: {
          success: true,
          sessions: expect.not.arrayContaining([
            expect.objectContaining({ key: 'agent:support:member-1' }),
          ]),
        },
      });
      expect(channelHistoryAfterDelete).toMatchObject({
        ok: true,
        data: {
          success: false,
          error: 'Session not found',
        },
      });

      const cronCreate = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Runtime follow up',
            message: 'summarize runtime state',
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
          },
        });
      });
      expect(cronCreate).toMatchObject({
        ok: true,
        data: {
          id: 'cron-e2e-1',
          name: 'Runtime follow up',
          message: 'summarize runtime state',
          enabled: true,
        },
      });

      const cronList = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list',
          module: 'cron',
          action: 'list',
        });
      });
      expect(cronList).toMatchObject({
        ok: true,
        data: [expect.objectContaining({ id: 'cron-e2e-1', name: 'Runtime follow up' })],
      });

      const cronToggle = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-toggle',
          module: 'cron',
          action: 'toggle',
          payload: { id: 'cron-e2e-1', enabled: false },
        });
      });
      expect(cronToggle).toMatchObject({
        ok: true,
        data: expect.objectContaining({ id: 'cron-e2e-1', enabled: false }),
      });

      const cronRun = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-run',
          module: 'cron',
          action: 'trigger',
          payload: { id: 'cron-e2e-1' },
        });
      });
      expect(cronRun).toMatchObject({ ok: true, data: { success: true } });

      const cronDelete = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete',
          module: 'cron',
          action: 'delete',
          payload: { id: 'cron-e2e-1' },
        });
      });
      expect(cronDelete).toMatchObject({ ok: true, data: { success: true } });

      await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-agent-chat',
          module: 'chat',
          action: 'sendWithMedia',
          payload: {
            sessionKey: 'agent:analysis:member-2',
            message: 'hello isolated agent workspace',
            deliver: false,
            idempotencyKey: 'analysis-agent-e2e',
          },
        });
      });
      const readAnalysisHistory = async () => await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: `runtime-agent-history-${Date.now()}`,
          module: 'sessions',
          action: 'history',
          payload: { sessionKey: 'agent:analysis:member-2', limit: 20 },
        });
      });
      await expect.poll(async () => readAnalysisHistory(), { timeout: 30_000 }).toMatchObject({
        ok: true,
        data: {
          success: true,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'hello isolated agent workspace' }),
          ]),
        },
      });
      const bridgeMessagesAfterCrossAgent = (await readFile(bridgeMessagesPath, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(bridgeMessagesAfterCrossAgent).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          content: 'hello isolated agent workspace',
          project: 'clawx-analysis',
          session_key: 'clawx:analysis:member-2',
        }),
      ]));
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts cc-connect runtime with an OpenAI API key provider profile', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const mockBundles = await prepareMockBundles(userDataDir);
    const envCapturePath = join(userDataDir, 'cc-connect-env.json');
    const createdAt = '2026-06-07T00:00:00.000Z';

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-main': {
          id: 'openai-main',
          vendorId: 'openai',
          label: 'OpenAI API Key',
          authMode: 'api_key',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {
        'openai-main': {
          type: 'api_key',
          accountId: 'openai-main',
          apiKey: 'sk-e2e-openai-secret',
        },
      },
      apiKeys: {},
      defaultProviderAccountId: 'openai-main',
    }, null, 2), 'utf8');
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: mockBundles.ccConnectPath,
        CLAWX_CODEX_PATH: mockBundles.codexPath,
        CLAWX_E2E_CC_CONNECT_ENV_PATH: envCapturePath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-openai-api-key',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('provider = "openai"');
      expect(managedConfig).toContain('api_key = "${CLAWX_CODEX_OPENAI_MAIN_API_KEY}"');
      expect(managedConfig).toContain('model = "gpt-5.5"');
      expect(managedConfig).not.toContain('sk-e2e-openai-secret');

      const envCapture = JSON.parse(await readFile(envCapturePath, 'utf8'));
      expect(envCapture).toMatchObject({
        CLAWX_CODEX_OPENAI_MAIN_API_KEY: 'sk-e2e-openai-secret',
      });
      expect(String(envCapture.CODEX_HOME)).toContain(join(userDataDir, 'credentials', 'oauth', 'openai-main', 'codex-home'));

      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CLAWX_CODEX_OPENAI_MAIN_API_KEY');
      expect(publicProfile).not.toContain('sk-e2e-openai-secret');

      const migratedProviderStore = JSON.parse(await readFile(join(userDataDir, 'clawx-providers.json'), 'utf8'));
      expect(migratedProviderStore.providerSecrets).toEqual({});
      expect(migratedProviderStore.apiKeys).toEqual({});
      const encryptedVault = await readFile(join(userDataDir, 'credentials', 'secrets.enc'));
      expect(encryptedVault.toString('utf8')).not.toContain('sk-e2e-openai-secret');
      const credentialIndex = await readFile(join(userDataDir, 'credentials', 'index.json'), 'utf8');
      expect(credentialIndex).toContain('openai-main');
      expect(credentialIndex).not.toContain('sk-e2e-openai-secret');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts cc-connect runtime with OpenAI OAuth Codex auth in a managed CODEX_HOME', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const mockBundles = await prepareMockBundles(userDataDir);
    const createdAt = '2026-06-07T00:00:00.000Z';

    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
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
        CLAWX_CC_CONNECT_PATH: mockBundles.ccConnectPath,
        CLAWX_CODEX_PATH: mockBundles.codexPath,
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

      const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');

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

  test('starts cc-connect runtime with existing managed Codex OAuth auth and no provider secret', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const mockBundles = await prepareMockBundles(userDataDir);
    const createdAt = '2026-06-07T00:00:00.000Z';
    const legacyCodexHome = join(userDataDir, 'runtimes', 'cc-connect', 'codex-home');
    const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');

    await mkdir(legacyCodexHome, { recursive: true });
    await writeFile(join(legacyCodexHome, 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'managed-e2e-id-token',
        access_token: 'managed-e2e-access-token',
        refresh_token: 'managed-e2e-refresh-token',
        account_id: 'acct_managed_e2e',
      },
      last_refresh: createdAt,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
      language: 'en',
      devModeUnlocked: true,
      runtimeKind: 'cc-connect',
      gatewayAutoStart: false,
    }, null, 2), 'utf8');
    await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
      schemaVersion: 0,
      providerAccounts: {
        'openai-oauth': {
          id: 'openai-oauth',
          vendorId: 'openai',
          label: 'OpenAI Codex OAuth',
          authMode: 'oauth_browser',
          model: 'gpt-5.5',
          enabled: true,
          isDefault: true,
          metadata: { email: 'user@example.com', resourceUrl: 'openai-codex' },
          createdAt,
          updatedAt: createdAt,
        },
      },
      providerSecrets: {},
      apiKeys: {},
      defaultProviderAccountId: 'openai-oauth',
    }, null, 2), 'utf8');
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: mockBundles.ccConnectPath,
        CLAWX_CODEX_PATH: mockBundles.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-managed-oauth',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const authJson = JSON.parse(await readFile(join(managedCodexHome, 'auth.json'), 'utf8'));
      expect(authJson).toMatchObject({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        last_refresh: createdAt,
        tokens: {
          id_token: 'managed-e2e-id-token',
          access_token: 'managed-e2e-access-token',
          refresh_token: 'managed-e2e-refresh-token',
          account_id: 'acct_managed_e2e',
        },
      });

      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('CODEX_HOME');
      expect(publicProfile).not.toContain('managed-e2e-access-token');
      expect(publicProfile).not.toContain('managed-e2e-refresh-token');
      expect(publicProfile).not.toContain('managed-e2e-id-token');
    } finally {
      await closeElectronApp(app);
    }
  });
});
