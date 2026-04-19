import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const PROJECT_MANAGER_SESSION_KEY = 'agent:main:main';
const CODER_SESSION_KEY = 'agent:coder:subagent:child-123';
const CODER_SESSION_ID = 'child-session-id';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: '[Mon 2026-04-06 15:18 GMT+8] Analyze Velaria uncommitted changes' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'spawn-call',
      name: 'sessions_spawn',
      arguments: { agentId: 'coder', task: 'analyze core blocks' },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'spawn-call',
    toolName: 'sessions_spawn',
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'accepted',
        childSessionKey: CODER_SESSION_KEY,
        runId: 'child-run-id',
        mode: 'run',
      }, null, 2),
    }],
    details: {
      status: 'accepted',
      childSessionKey: CODER_SESSION_KEY,
      runId: 'child-run-id',
      mode: 'run',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'yield-call',
      name: 'sessions_yield',
      arguments: { message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.' },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'yield-call',
    toolName: 'sessions_yield',
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'yielded',
        message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.',
      }, null, 2),
    }],
    details: {
      status: 'yielded',
      message: 'I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'user',
    content: [{
      type: 'text',
      text: `[Internal task completion event]
source: subagent
session_key: ${CODER_SESSION_KEY}
session_id: ${CODER_SESSION_ID}
type: subagent task
status: completed successfully`,
    }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Coder has finished the analysis, here are the conclusions.' }],
    _attachedFiles: [
      {
        fileName: 'CHECKLIST.md',
        mimeType: 'text/markdown',
        fileSize: 433,
        preview: null,
        filePath: '/Users/bytedance/.openclaw/workspace/CHECKLIST.md',
        source: 'tool-result',
      },
    ],
    timestamp: Date.now(),
  },
];

const childTranscriptMessages = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Analyze the core content of ~/Velaria uncommitted changes' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'coder-exec-call',
      name: 'exec',
      arguments: {
        command: "cd ~/Velaria && git status --short && sed -n '1,200p' src/dataflow/core/logical/planner/plan.h",
        workdir: '/Users/bytedance/.openclaw/workspace-coder',
      },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'toolResult',
    toolCallId: 'coder-exec-call',
    toolName: 'exec',
    content: [{ type: 'text', text: 'M src/dataflow/core/logical/planner/plan.h' }],
    details: {
      status: 'completed',
      aggregated: "M src/dataflow/core/logical/planner/plan.h\nM src/dataflow/core/execution/runtime/execution_optimizer.cc",
      cwd: '/Users/bytedance/.openclaw/workspace-coder',
    },
    isError: false,
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Analysis complete, there are 4 key blocks.' }],
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat execution graph', () => {
  test('renders internal yield status and linked subagent branch from mocked IPC', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: PROJECT_MANAGER_SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: {
              messages: seededHistory,
            },
          },
          [stableStringify(['chat.history', { sessionKey: PROJECT_MANAGER_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: {
              messages: seededHistory,
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  { id: 'main', name: 'main' },
                  { id: 'coder', name: 'coder' },
                ],
              },
            },
          },
          [stableStringify([`/api/sessions/transcript?agentId=coder&sessionId=${CODER_SESSION_ID}`, 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                messages: childTranscriptMessages,
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('sessions_yield', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('coder subagent')).toBeVisible();
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('exec', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-testid="chat-execution-graph"]').getByText('I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.')).toBeVisible();
      await expect(page.getByText('CHECKLIST.md')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not duplicate the in-flight user prompt or cumulative streaming content', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: PROJECT_MANAGER_SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: {
              messages: [],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
        },
      });

      await app.evaluate(async ({ app: _app }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const sendPayloads: Array<{ message?: string; sessionKey?: string }> = [];
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, payload: unknown) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: {
                sessions: [{ key: 'agent:main:main', displayName: 'main' }],
              },
            };
          }
          if (method === 'chat.history') {
            return {
              success: true,
              result: { messages: [] },
            };
          }
          if (method === 'chat.send') {
            if (payload && typeof payload === 'object') {
              const p = payload as { message?: string; sessionKey?: string };
              sendPayloads.push({ message: p.message, sessionKey: p.sessionKey });
            }
            return {
              success: true,
              result: { runId: 'mock-run' },
            };
          }
          return { success: true, result: {} };
        });
        (globalThis as typeof globalThis & { __clawxSendPayloads?: Array<{ message?: string; sessionKey?: string }> }).__clawxSendPayloads = sendPayloads;
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('chat-composer-input').fill('Open browser, search for tech news, and take a screenshot');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByText('Open browser, search for tech news, and take a screenshot')).toHaveCount(1);
      await expect.poll(async () => {
        return await app.evaluate(() => {
          const sendPayloads = (globalThis as typeof globalThis & {
            __clawxSendPayloads?: Array<{ message?: string; sessionKey?: string }>;
          }).__clawxSendPayloads || [];
          return sendPayloads.length;
        });
      }).toBe(1);

      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:notification', {
          method: 'agent',
          params: {
            runId: 'mock-run',
            sessionKey: 'agent:main:main',
            state: 'delta',
            message: {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'thinking 1' },
                { type: 'thinking', thinking: 'thinking 1 2' },
                { type: 'thinking', thinking: 'thinking 1 2 3' },
                { type: 'text', text: '1' },
                { type: 'text', text: '1 2' },
                { type: 'text', text: '1 2 3' },
              ],
            },
          },
        });
      });

      await expect(page.getByText('Open browser, search for tech news, and take a screenshot')).toHaveCount(1);
      await expect(page.getByText(/^thinking 1 2 3$/)).toHaveCount(1);
      await expect(page.getByText(/^thinking 1 2$/)).toHaveCount(0);
      await expect(page.getByText(/^thinking 1$/)).toHaveCount(0);
      await expect(page.getByText(/^1 2 3$/)).toHaveCount(1);
      await expect(page.getByText(/^1 2$/)).toHaveCount(0);
      await expect(page.getByText(/^1$/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
