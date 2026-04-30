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

const history = [
  {
    role: 'user',
    id: 'user-1',
    content: [{ type: 'text', text: 'Patch the workspace file' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-tool-1',
    content: [{
      type: 'toolCall',
      id: 'edit-1',
      name: 'Edit',
      arguments: {
        file_path: '/workspace/demo.ts',
        old_string: 'const value = 1\n',
        new_string: 'const value = 2\n',
      },
    }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-final-1',
    content: [{ type: 'text', text: 'Updated the file.' }],
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat file changes', () => {
  test('shows line stats on generated file cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: history },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: history },
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
      await expect(page.getByRole('button', { name: '工作空间' })).toHaveCount(0);
      await expect(page.getByText('查看文件变更')).toHaveCount(0);

      const fileCard = page.getByRole('button', { name: /demo\.ts/ }).first();
      await expect(fileCard).toBeVisible({ timeout: 30_000 });
      await expect(fileCard).toContainText('+1');
      await expect(fileCard).toContainText('-1');

      await fileCard.click();
      await expect(page.locator('aside').getByRole('button', { name: '工作空间' })).toHaveCount(0);
      await expect(fileCard).toContainText('demo.ts');
    } finally {
      await closeElectronApp(app);
    }
  });
});
