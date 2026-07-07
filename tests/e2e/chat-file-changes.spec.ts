import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const workspacePath = '/Users/e2e/.openclaw/workspace-main';
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function hostJson(json: unknown) {
  return {
    ok: true,
    data: {
      status: 200,
      ok: true,
      json,
    },
  };
}

function acpFileUpdates(input: {
  filePath: string;
  fileName: string;
  mimeType: string;
  prompt: string;
  response: string;
}): AcpSessionUpdate[] {
  const id = input.fileName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return [
    {
      sessionUpdate: 'user_message',
      messageId: `user-${id}`,
      content: [{ type: 'text', text: input.prompt }],
    },
    {
      sessionUpdate: 'tool_call',
      toolCallId: `tool-${id}`,
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: input.response } }],
      locations: [{ path: input.filePath, name: input.fileName }],
    },
    {
      sessionUpdate: 'agent_message',
      messageId: `assistant-${id}`,
      content: [
        { type: 'text', text: input.response },
        { type: 'resource_link', uri: input.filePath, name: input.fileName, mimeType: input.mimeType },
      ],
    },
  ];
}

async function installAcpLoadReplayMock(app: ElectronApplication, updates: AcpSessionUpdate[]) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    let generation = 0;

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        generation += 1;
        const sessionKey = typeof request.payload?.sessionKey === 'string'
          ? request.payload.sessionKey
          : payload.sessionKey;

        for (const update of payload.updates as AcpSessionUpdate[]) {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('chat:acp-session-update', {
              sessionKey,
              generation,
              historical: true,
              notification: {
                sessionId: sessionKey,
                update,
              },
            });
          }
        }
        return { id: request.id, ok: true, data: { success: true, generation } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { sessionKey: SESSION_KEY, updates });
}

async function installChatFileMocks(app: ElectronApplication, options: {
  updates: AcpSessionUpdate[];
  workspace: string;
  agentName?: string;
}) {
  const nowMs = Date.now();
  const settingsSnapshot = {
    language: 'en',
    setupComplete: true,
    chatWorkspacePath: options.workspace,
    recentWorkspacePaths: [options.workspace],
  };
  const sessionSummaries = {
    summaries: [{
      sessionKey: SESSION_KEY,
      firstUserText: 'Patch the workspace file',
      lastTimestamp: nowMs,
      workspacePath: options.workspace,
    }],
  };

  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: nowMs },
    gatewayRpc: {
      [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
        success: true,
        result: {
          sessions: [{ key: SESSION_KEY, displayName: 'main', updatedAt: nowMs }],
        },
      },
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: SESSION_KEY, displayName: 'main', updatedAt: nowMs }],
        },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: [] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: [] },
      },
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: settingsSnapshot,
      [stableStringify(['/api/settings', 'GET'])]: hostJson(settingsSnapshot),
      [stableStringify(['/api/gateway/status', 'GET'])]: hostJson({ state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: nowMs }),
      [stableStringify(['/api/agents', 'GET'])]: hostJson({
        success: true,
        agents: [{ id: 'main', name: options.agentName ?? 'main', workspace: options.workspace, mainSessionKey: SESSION_KEY }],
      }),
      [stableStringify(['sessions', 'summaries', { sessionKeys: [SESSION_KEY] }])]: sessionSummaries,
      [stableStringify(['/api/sessions/summaries', 'POST'])]: hostJson(sessionSummaries),
    },
  });

  await installAcpLoadReplayMock(app, options.updates);
}
test.describe('ClawX chat file changes', () => {
  test('shows workspace first with hidden files and compressed path', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installChatFileMocks(app, {
        workspace: workspacePath,
        agentName: 'Main Agent',
        updates: acpFileUpdates({
          filePath: `${workspacePath}/demo.ts`,
          fileName: 'demo.ts',
          mimeType: 'text/typescript',
          prompt: 'Patch the workspace file',
          response: 'Updated demo.ts.',
        }),
      });

      await app.evaluate(async ({ app: _app }, { workspacePath: mockedWorkspacePath }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('file:listTree');
        ipcMain.handle('file:listTree', async (_event: unknown, inputPath: string, opts?: { includeHidden?: boolean }) => {
          if (inputPath !== mockedWorkspacePath || opts?.includeHidden !== true) {
            return { ok: false, error: 'unexpectedListTreeRequest' };
          }
          return {
            ok: true,
            root: {
              name: 'workspace-main',
              relPath: '',
              absPath: mockedWorkspacePath,
              isDir: true,
              children: [
                {
                  name: '.env',
                  relPath: '.env',
                  absPath: `${mockedWorkspacePath}/.env`,
                  isDir: false,
                  size: 16,
                  mtime: Date.now(),
                },
                {
                  name: 'demo.ts',
                  relPath: 'demo.ts',
                  absPath: `${mockedWorkspacePath}/demo.ts`,
                  isDir: false,
                  size: 24,
                  mtime: Date.now(),
                },
              ],
            },
            truncated: false,
          };
        });
      }, { workspacePath });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByText('demo.ts').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-workspace-selector')).toHaveText('~/.openclaw/workspace-main', { timeout: 30_000 });
      await page.getByTestId('chat-toolbar-workspace').click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      const tabLabels = await sidePanel.locator('[data-testid^="artifact-panel-tab-"]').evaluateAll((buttons) => (
        buttons.map((button) => button.textContent?.trim())
      ));
      expect(tabLabels).toEqual(['Workspace', 'Preview', 'Changes']);

      await sidePanel.getByTestId('artifact-panel-tab-browser').click();
      await expect(sidePanel.getByTestId('workspace-path-tag')).toHaveText('~/.openclaw/workspace-main');
      await expect(sidePanel.getByTestId('workspace-path-tag')).toHaveAttribute('title', workspacePath);
      await expect(sidePanel.getByTestId('workspace-path-final-segment')).toHaveText('workspace-main');
      await expect(sidePanel.getByRole('button', { name: /hidden files/i })).toHaveCount(0);
      await expect(sidePanel.getByText('.env')).toBeVisible({ timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('focuses ACP-generated files in the changes panel', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installChatFileMocks(app, {
        workspace: '/workspace',
        updates: acpFileUpdates({
          filePath: '/workspace/demo.ts',
          fileName: 'demo.ts',
          mimeType: 'text/typescript',
          prompt: 'Patch the workspace file',
          response: 'Updated demo.ts.',
        }),
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
      await expect(page.getByText('demo.ts').first()).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-toolbar-workspace').click();
      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByTestId('artifact-panel-tab-browser')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-tab-changes').click();
      await expect(sidePanel.getByRole('heading', { name: 'demo.ts' })).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByText(/no diff is available/i)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens html files from chat as rendered previews', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installChatFileMocks(app, {
        workspace: '/workspace',
        updates: acpFileUpdates({
          filePath: '/workspace/demo.html',
          fileName: 'demo.html',
          mimeType: 'text/html',
          prompt: '预览 HTML 页面',
          response: '已生成 /workspace/demo.html',
        }),
      });

      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('file:stat');
        ipcMain.handle('file:stat', async (_event: unknown, inputPath: string) => ({
          ok: inputPath === '/workspace/demo.html',
          size: 154,
          isFile: inputPath === '/workspace/demo.html',
          isDir: false,
          readOnly: true,
        }));
        ipcMain.removeHandler('file:readText');
        ipcMain.handle('file:readText', async (_event: unknown, inputPath: string) => {
          if (inputPath !== '/workspace/demo.html') return { ok: false, error: 'notFound' };
          return {
            ok: true,
            content: '<!doctype html><html><body><h1 id="title">HTML Rendered Preview</h1><script>document.body.dataset.htmlPreview = "ok";</script></body></html>',
            size: 154,
            mimeType: 'text/html',
            readOnly: true,
          };
        });
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
      await expect(page.getByText('demo.html').first()).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-toolbar-workspace').click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await sidePanel.getByTestId('artifact-panel-tab-changes').click();
      await expect(sidePanel.getByRole('heading', { name: 'demo.html' })).toBeVisible({ timeout: 30_000 });
      await sidePanel.getByTestId('artifact-panel-tab-preview').click();
      const frame = sidePanel.getByTestId('html-preview-frame');
      await expect(frame).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByText('<!doctype html>')).toHaveCount(0);
      const htmlFrame = frame.contentFrame();
      await expect(htmlFrame.locator('#title')).toHaveText('HTML Rendered Preview');
      await expect(htmlFrame.locator('body')).toHaveAttribute('data-html-preview', 'ok');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps an attached file selected after switching through workspace', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installChatFileMocks(app, {
        workspace: '/workspace',
        updates: acpFileUpdates({
          filePath: '/workspace/skills/open-xueqiu/SKILL.md',
          fileName: 'SKILL.md',
          mimeType: 'text/markdown',
          prompt: '查看这个技能文件',
          response: '这是文件。',
        }),
      });

      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('file:readText');
        ipcMain.handle('file:readText', async (_event: unknown, inputPath: string) => {
          if (inputPath !== '/workspace/skills/open-xueqiu/SKILL.md') return { ok: false, error: 'notFound' };
          return {
            ok: true,
            content: '# SKILL\n\nOpen Xueqiu skill details.',
            size: 36,
            mimeType: 'text/markdown',
            readOnly: true,
          };
        });
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
      await expect(page.getByText('SKILL.md').first()).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-toolbar-workspace').click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await sidePanel.getByTestId('artifact-panel-tab-changes').click();
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
