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

const longRunPrompt = 'Inspect the workspace and summarize the result';
const longRunProcessSegments = Array.from({ length: 9 }, (_, index) => `Checked source ${index + 1}.`);
const longRunSummary = 'Here is the summary.';
const longRunReplyText = `${longRunProcessSegments.join(' ')} ${longRunSummary}`;
const longRunHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: longRunPrompt }],
    timestamp: Date.now(),
  },
  ...longRunProcessSegments.map((segment, index) => ({
    role: 'assistant',
    id: `long-run-step-${index + 1}`,
    content: [{ type: 'text', text: segment }],
    timestamp: Date.now(),
  })),
  {
    role: 'assistant',
    id: 'long-run-final',
    content: [{ type: 'text', text: longRunReplyText }],
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
      // Completed runs auto-collapse into a single-line summary button. Expand
      // it first so the underlying step details are rendered.
      const graph = page.getByTestId('chat-execution-graph');
      if ((await graph.getAttribute('data-collapsed')) === 'true') {
        await graph.click();
      }
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('sessions_yield', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('coder subagent')).toBeVisible();
      await expect(
        page.locator('[data-testid="chat-execution-graph"] [data-testid="chat-execution-step"]').getByText('exec', { exact: true }),
      ).toBeVisible();
      const execRow = page.locator('[data-testid="chat-execution-step"]').filter({ hasText: 'exec' }).first();
      await execRow.click();
      await expect(execRow.locator('pre')).toBeVisible();
      await expect(page.locator('[data-testid="chat-execution-graph"]').getByText('I asked coder to break down the core blocks of ~/Velaria uncommitted changes; will give you the conclusion when it returns.')).toBeVisible();
      await expect(page.getByText('CHECKLIST.md')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves long execution history counts and strips the full folded reply prefix', async ({ launchElectronApp }) => {
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
              messages: longRunHistory,
            },
          },
          [stableStringify(['chat.history', { sessionKey: PROJECT_MANAGER_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: {
              messages: longRunHistory,
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
      await expect(page.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'true');
      await expect(page.getByTestId('chat-execution-graph')).toContainText('0 tool calls');
      await expect(page.getByTestId('chat-execution-graph')).toContainText('9 process messages');
      await expect(page.getByText(longRunSummary, { exact: true })).toBeVisible();
      await expect(page.getByText(longRunReplyText, { exact: true })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

});
