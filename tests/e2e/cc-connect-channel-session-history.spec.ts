import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('cc-connect channel session history', () => {
  test('renders channel sessions in the sidebar and loads their history', async ({ launchElectronApp }) => {
    const sessionKey = 'agent:coder:feishu:oc_probe:ou_probe';
    const sessionUpdatedAt = Date.now();
    const seededHistory = [
      { id: 'm1', role: 'user', content: '飞书 hello', timestamp: sessionUpdatedAt - 1_000 },
      {
        id: 'm-tool-call',
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-feishu-bash',
          name: 'Bash',
          arguments: { cmd: 'pwd && ls' },
        }],
        timestamp: sessionUpdatedAt - 800,
        stopReason: 'tool_use',
      },
      {
        id: 'm-tool-result',
        role: 'toolresult',
        toolCallId: 'call-feishu-bash',
        toolName: 'Bash',
        content: '/tmp/workspace',
        timestamp: sessionUpdatedAt - 700,
      },
      { id: 'm2', role: 'assistant', content: '飞书 reply', timestamp: sessionUpdatedAt },
    ];
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          port: 18789,
          pid: 12345,
          gatewayReady: true,
          runtimeKind: 'cc-connect',
        },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{
                key: sessionKey,
                displayName: '飞书会话',
                derivedTitle: '飞书 hello',
                lastMessagePreview: '飞书 reply',
                agentId: 'coder',
                updatedAt: sessionUpdatedAt,
              }],
            },
          },
          [stableStringify(['chat.history', { sessionKey, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                gatewayReady: true,
                runtimeKind: 'cc-connect',
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'coder', name: 'Coder' }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId(`sidebar-session-${sessionKey}`)).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${sessionKey}`)).toContainText('Feishu / Lark: 飞书 hello');
      await expect(page.getByTestId(`sidebar-session-${sessionKey}`)).toContainText('Coder');
      await page.getByTestId(`sidebar-session-${sessionKey}`).click();
      await expect(page.getByTestId('chat-message-0').getByText('飞书 hello')).toBeVisible();
      await expect(page.getByText('飞书 reply')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
      await page.getByTestId('chat-execution-graph').click();
      await expect(page.getByTestId('chat-execution-graph')).toContainText('Bash');
    } finally {
      await closeElectronApp(app);
    }
  });
});
