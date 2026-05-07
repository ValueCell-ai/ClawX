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

const attachedFileHistory = [
  {
    role: 'user',
    id: 'user-attached-1',
    content: [{ type: 'text', text: '查看这个技能文件' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'assistant-attached-1',
    content: [{ type: 'text', text: '这是文件。' }],
    _attachedFiles: [
      {
        fileName: 'SKILL.md',
        mimeType: 'text/markdown',
        fileSize: 128,
        preview: null,
        filePath: '/workspace/skills/open-xueqiu/SKILL.md',
        source: 'tool-result',
      },
    ],
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
      await page.evaluate(() => {
        const root = document.documentElement;
        root.classList.remove('dark');
        root.classList.add('light');
      });
      await expect(page.getByTestId('artifact-panel')).toHaveCount(0);

      const fileCard = page.getByRole('button', { name: /demo\.ts/ }).first();
      await expect(fileCard).toBeVisible({ timeout: 30_000 });
      await expect(fileCard).toContainText('+1');
      await expect(fileCard).toContainText('-1');

      await fileCard.click();
      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByTestId('artifact-panel-tab-browser')).toBeVisible();
      await expect(fileCard).toContainText('demo.ts');

      const diffBackground = page.getByTestId('monaco-diff-viewer').locator('.monaco-editor-background').first();
      await expect(diffBackground).toBeVisible({ timeout: 30_000 });

      const colors = await diffBackground.evaluate((element) => {
        return {
          diffBackground: window.getComputedStyle(element).backgroundColor,
          appBackground: window.getComputedStyle(document.body).backgroundColor,
        };
      });

      expect(colors.diffBackground).toBe(colors.appBackground);
      expect(colors.diffBackground).not.toBe('rgb(255, 255, 255)');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps an attached file selected after switching through workspace', async ({ launchElectronApp }) => {
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
            result: { messages: attachedFileHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000 }])]: {
            success: true,
            result: { messages: attachedFileHistory },
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
                agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
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
      const skillFileCard = page.locator('[title="Open file"]').filter({ hasText: 'SKILL.md' }).first();
      await expect(skillFileCard).toBeVisible({ timeout: 30_000 });
      await skillFileCard.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel.getByRole('heading', { name: 'SKILL.md' })).toBeVisible({ timeout: 30_000 });

      await sidePanel.getByTestId('artifact-panel-tab-browser').click();
      await sidePanel.getByTestId('artifact-panel-tab-preview').click();
      await expect(sidePanel.getByRole('heading', { name: 'SKILL.md' })).toBeVisible();
      await expect(sidePanel.getByText('No file selected')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
