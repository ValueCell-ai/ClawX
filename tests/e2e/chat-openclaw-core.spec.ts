import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('OpenClaw core Chat surface', () => {
  test('renders history on the default Chat page without duplicate user messages', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                { id: 'u1', role: 'user', content: 'hello' },
                { id: 'a1', role: 'assistant', content: 'hi' },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('openclaw-chat-surface')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('hello')).toHaveCount(1);
      await expect(page.getByText('hi')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders OpenClaw assistant Markdown as rich Markdown', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                {
                  id: 'a1',
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: [
                        '### Rendered heading',
                        '',
                        '- **bold** item',
                        '- `inlineCode()` item',
                      ].join('\n'),
                    },
                  ],
                },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByRole('heading', { name: 'Rendered heading', level: 3 })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('strong', { hasText: 'bold' })).toBeVisible();
      await expect(page.locator('code', { hasText: 'inlineCode()' })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders split history tool use and result as one expandable card', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                {
                  id: 'assistant-tool-call',
                  role: 'assistant',
                  content: [
                    { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/a.md' } },
                  ],
                },
                {
                  id: 'tool-result',
                  role: 'toolResult',
                  toolCallId: 'call-1',
                  toolName: 'read',
                  content: [{ type: 'text', text: 'file contents' }],
                },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-tool-card')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-tool-card')).toHaveCount(1);
      await expect(page.getByTestId('chat-tool-card')).toContainText('read');
      await expect(page.getByTestId('chat-tool-card')).toHaveClass(/w-\[50vw\]/);
      await expect(page.getByText('file contents')).toHaveCount(0);
      await page.getByRole('button', { name: /read/i }).click();
      await expect(page.getByTestId('chat-tool-card')).toContainText('/tmp/a.md');
      await expect(page.getByTestId('chat-tool-card')).toContainText('file contents');
      await expect(page.getByTestId('chat-tool-card-preview')).toBeVisible();
      await page.getByTestId('chat-tool-card-preview').click();
      await expect(page.getByTestId('artifact-panel-aside')).toBeVisible();
      await expect(page.getByTestId('artifact-panel-aside')).toContainText('a.md');
      await expect(page.getByRole('button', { name: 'Raw output' })).toHaveCount(0);
      await expect(page.getByTestId('chat-raw-output-panel')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders media-path history attachments without leaking media URL marker text', async ({ launchElectronApp }) => {
    const imagePath = '/tmp/loose history image.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                {
                  id: 'user-with-loose-media',
                  role: 'user',
                  content: 'Describe this image\n\n[media attached: media://inbound/loose-history-image.png (image/png)]',
                  MediaPath: imagePath,
                  MediaType: 'image/png',
                },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['media', 'thumbnails', { paths: [{ filePath: imagePath, mimeType: 'image/png' }] }])]: {
            [imagePath]: { preview, fileSize: 68 },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByText('Describe this image')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/media attached:/i)).toHaveCount(0);
      await expect(page.getByAltText('loose history image.png')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders persisted assistant text before a tool call in the same assistant row', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                {
                  id: 'assistant-tool-call',
                  role: 'assistant',
                  stopReason: 'toolUse',
                  content: [
                    { type: 'text', phase: 'commentary', text: 'First explanation.' },
                    { type: 'tool_use', id: 'call-1', name: 'web_search', input: { query: 'tech trends' } },
                  ],
                },
                {
                  id: 'tool-result',
                  role: 'toolResult',
                  toolCallId: 'call-1',
                  toolName: 'web_search',
                  content: [{ type: 'text', text: 'search results' }],
                },
                {
                  id: 'assistant-gateway-fallback',
                  role: 'assistant',
                  content: [{ type: 'text', text: 'First explanation.' }],
                  openclawStreamFallback: { replacementText: 'First explanation.' },
                },
                {
                  id: 'assistant-final',
                  role: 'assistant',
                  content: [{ type: 'text', text: 'Final explanation.' }],
                },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByText('First explanation.')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('First explanation.')).toHaveCount(1);
      await expect(page.getByTestId('chat-tool-card')).toContainText('web_search');
      await expect(page.getByText('Final explanation.')).toBeVisible();
      await expect(page.getByTestId('chat-assistant-avatar')).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows production sends as optimistic user messages in the OpenClaw surface', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-optimistic' },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('show this immediately');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-optimistic-user-message')).toContainText('show this immediately');
      await expect(page.getByTestId('chat-running-pulse')).toBeVisible();
      await expect(page.getByTestId('chat-run-status')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps live output visible while post-final history hydration is still empty', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-hydration-empty' },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('hydrate without blanking');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-optimistic-user-message')).toContainText('hydrate without blanking');

      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('gateway:agent-event', payload.assistant);
          win.webContents.send('gateway:agent-event', payload.done);
        }
      }, {
        assistant: {
          sessionKey: SESSION_KEY,
          runId: 'run-hydration-empty',
          stream: 'assistant',
          ts: 1000,
          data: {
            phase: 'final_answer',
            text: 'This live answer should stay visible.',
          },
        },
        done: {
          sessionKey: SESSION_KEY,
          runId: 'run-hydration-empty',
          stream: 'lifecycle',
          ts: 1001,
          data: { phase: 'done' },
        },
      });

      await expect(page.getByText('This live answer should stay visible.')).toBeVisible();
      await page.waitForTimeout(1800);
      await expect(page.getByTestId('chat-optimistic-user-message')).toContainText('hydrate without blanking');
      await expect(page.getByText('This live answer should stay visible.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders runtime indicators and resolves approval cards from upstream agent events', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['exec.approval.resolve', { id: 'approval-1', decision: 'allow-once' }])]: {
            success: true,
            result: { ok: true },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('openclaw-chat-surface')).toBeVisible({ timeout: 30_000 });

      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('gateway:agent-event', payload.compaction);
          win.webContents.send('gateway:agent-event', payload.approval);
        }
      }, {
        compaction: {
          sessionKey: SESSION_KEY,
          runId: 'run-1',
          stream: 'compaction',
          data: { phase: 'start', messages: ['Memory pressure detected'] },
        },
        approval: {
          sessionKey: SESSION_KEY,
          runId: 'run-1',
          stream: 'approval',
          data: {
            phase: 'requested',
            status: 'pending',
            approvalId: 'approval-1',
            kind: 'exec',
            title: 'Command approval requested',
            command: 'git status',
          },
        },
      });

      await expect(page.getByTestId('chat-runtime-indicator').filter({
        hasText: 'Memory pressure detected',
      })).toBeVisible();
      await expect(page.getByTestId('chat-approval-card')).toContainText('git status');

      await page.getByRole('button', { name: 'Allow once' }).click();
      await expect(page.getByTestId('chat-approval-card')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders raw OpenClaw runtime items and localized composer running pulse', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                language: 'zh',
                setupComplete: true,
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('openclaw-chat-surface')).toBeVisible({ timeout: 30_000 });

      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('gateway:agent-event', payload.lifecycle);
          win.webContents.send('gateway:agent-event', payload.thinking);
          win.webContents.send('gateway:agent-event', payload.command);
          win.webContents.send('gateway:agent-event', payload.patch);
        }
      }, {
        lifecycle: {
          sessionKey: SESSION_KEY,
          runId: 'run-items',
          stream: 'lifecycle',
          data: { phase: 'start' },
        },
        thinking: {
          sessionKey: SESSION_KEY,
          runId: 'run-items',
          stream: 'thinking',
          data: { text: 'Planning the edit path' },
        },
        command: {
          sessionKey: SESSION_KEY,
          runId: 'run-items',
          stream: 'command_output',
          data: {
            title: 'Run tests',
            command: 'pnpm test -- --runInBand',
            output: '2 tests passed',
            exitCode: 0,
            durationMs: 1250,
          },
        },
        patch: {
          sessionKey: SESSION_KEY,
          runId: 'run-items',
          stream: 'patch',
          data: {
            summary: 'Updated chat runtime item rendering',
            filePaths: ['src/pages/Chat/MessageList.tsx', 'src/pages/Chat/CommandCard.tsx'],
            fileCount: 2,
            added: 28,
            modified: 3,
            deleted: 1,
          },
        },
      });

      await expect(page.getByTestId('chat-running-pulse')).toBeVisible();
      await expect(page.getByTestId('chat-running-pulse')).toHaveText('AI 回复中');

      await expect(page.getByTestId('chat-thinking-block')).toContainText('思考过程');
      await expect(page.getByText('Planning the edit path')).toHaveCount(0);
      await page.getByRole('button', { name: /思考过程/ }).click();
      await expect(page.getByTestId('chat-thinking-block')).toContainText('Planning the edit path');
      await expect(page.getByTestId('chat-command-card')).toContainText('Run tests');
      await expect(page.getByTestId('chat-command-card')).toContainText('pnpm test -- --runInBand');
      await expect(page.getByTestId('chat-command-card')).toContainText('2 tests passed');
      await expect(page.getByTestId('chat-command-card')).toContainText('1.3 秒');
      await expect(page.getByTestId('chat-patch-card')).toContainText('Updated chat runtime item rendering');
      await expect(page.getByTestId('chat-patch-card')).toContainText('2 个文件');
      await expect(page.getByTestId('chat-patch-card')).toContainText('+28');
      await expect(page.getByTestId('chat-patch-card')).toContainText('-1');
      await expect(page.getByRole('button', { name: 'Raw output' })).toHaveCount(0);
      await expect(page.getByTestId('chat-raw-output-panel')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
