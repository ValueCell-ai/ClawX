import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const REVIEWER_SESSION_KEY = 'agent:reviewer:main';
const REVIEWER_WORKSPACE = '/workspace/reviewer';
const IMAGE_TASK_ID = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
const GENERATED_IMAGE_PATH = '/workspace/.openclaw/media/tool-image-generation/generated-image.png';
const GENERATED_IMAGE_PREVIEW = 'data:image/png;base64,iVBORw0KGgo=';
const DEFAULT_WORKSPACE_SEGMENT = '~%2F.openclaw%2Fworkspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function defaultWorkspaceSessionGroupTestId(): string {
  return `workspace-session-group-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function baseHostApiMocks(loadResult: Record<string, unknown> = { success: true, generation: 1 }) {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: MAIN_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: DEFAULT_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: '/' }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: '/', createIfMissing: true }])]: loadResult,
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'main',
            workspace: MAIN_WORKSPACE,
            mainSessionKey: MAIN_SESSION_KEY,
          }],
        },
      },
    },
  };
}

async function installAcpChatMocks(app: ElectronApplication) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
        },
      },
    },
    hostApi: baseHostApiMocks(),
  });
}

async function installAcpLoadReplayMock(app: ElectronApplication, updates: AcpSessionUpdate[]) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        for (const update of payload.updates as AcpSessionUpdate[]) {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('chat:acp-session-update', {
              sessionKey: payload.sessionKey,
              generation: 1,
              historical: true,
              notification: {
                sessionId: payload.sessionKey,
                update,
              },
            });
          }
        }
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { sessionKey: MAIN_SESSION_KEY, updates });
}

async function installAcpLoadRecorderMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
      args?: unknown[];
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as { __acpLoadSessionKeys?: string[] };
    globals.__acpLoadSessionKeys = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] : undefined);
        const sessionKey = requestPayload && typeof requestPayload === 'object'
          ? String((requestPayload as Record<string, unknown>).sessionKey ?? '')
          : '';
        globals.__acpLoadSessionKeys?.push(sessionKey);

        if (sessionKey === payload.mainSessionKey) {
          return {
            id: request.id,
            ok: true,
            data: { success: false, error: 'Unexpected heartbeat-only session load in E2E test' },
          };
        }
        if (/^agent:main:session-/.test(sessionKey)) {
          return { id: request.id, ok: true, data: { success: true, generation: 1 } };
        }
        return {
          id: request.id,
          ok: true,
          data: { success: false, error: `Unexpected ACP session load in E2E test: ${sessionKey}` },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { mainSessionKey: MAIN_SESSION_KEY });
}

async function getRecordedAcpLoadSessionKeys(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as { __acpLoadSessionKeys?: string[] }).__acpLoadSessionKeys ?? [];
  });
}

async function installMediaSaveRecorder(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as { __mediaSaveImagePayloads?: Record<string, unknown>[] };
    globals.__mediaSaveImagePayloads = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'media' && request.action === 'saveImage' && request.payload) {
        globals.__mediaSaveImagePayloads?.push(request.payload);
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function getRecordedMediaSaveImagePayloads(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as { __mediaSaveImagePayloads?: Record<string, unknown>[] }).__mediaSaveImagePayloads ?? [];
  });
}

async function installAcpPromptSuccessMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function installAcpPromptFailureMock(app: ElectronApplication, error: string) {
  await app.evaluate(async ({ app: _app }, promptError) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return { id: request.id, ok: true, data: { success: false, error: promptError } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, error);
}

async function installAcpPromptDeferredMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return await new Promise((resolve) => {
          (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt = () => resolve({ id: request.id, ok: true, data: { success: true, generation: 1 } });
        });
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function resolveDeferredAcpPrompt(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt?.();
  });
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  generation = 1,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: payload.generation,
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: MAIN_SESSION_KEY, generation, updates },
  );
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('ClawX ACP inline timeline', () => {
  test('renders ACP tool updates inline without the legacy execution graph', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'inline-user',
          content: [{ type: 'text', text: 'Inspect the project files' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-package',
          title: 'Read package.json',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Loaded package metadata' } }],
          locations: [],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('acp-tool-call-card')).toBeVisible();
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read package.json');
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Loaded package metadata');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows optimistic user messages immediately and coalesces streamed assistant chunks', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptSuccessMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('Plan the migration');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Plan the migration')).toBeVisible();

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-stream',
          content: { type: 'text', text: 'Streaming' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-stream',
          content: { type: 'text', text: ' response' },
        },
      ]);

      await expect(page.locator('.prose').filter({ hasText: 'Streaming response' })).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows assistant identity and copies ACP assistant text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: (value: string) => {
              (window as unknown as { __acpCopiedText?: string }).__acpCopiedText = value;
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message',
          messageId: 'assistant-copy',
          content: [{ type: 'text', text: 'Copy this ACP answer' }],
        },
      ]);

      const assistantMessage = page.getByTestId('acp-assistant-message');
      await expect(assistantMessage).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toBeVisible();

      await assistantMessage.hover();
      await page.getByTestId('acp-assistant-copy').click();

      await expect(page.getByTestId('acp-assistant-copy')).toHaveAttribute('aria-label', 'Copied');
      await expect.poll(() => page.evaluate(() => (window as unknown as { __acpCopiedText?: string }).__acpCopiedText)).toBe('Copy this ACP answer');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves ACP tool output newlines and indentation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      const output = 'line one\n  indented line\ncolumn_a\tcolumn_b';
      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'format-output',
          title: 'Inspect formatted output',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: output } }],
          locations: [],
        },
      ]);

      const pre = page.getByTestId('acp-tool-output-pre');
      await expect(pre).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => pre.evaluate((element) => element.textContent)).toBe(output);
      await expect.poll(() => pre.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('groups assistant text and tool calls into one assistant turn', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: { type: 'text', text: 'I will inspect the file.' },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-grouped',
          title: 'Read grouped file',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'grouped output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: { type: 'text', text: ' The file is safe.' },
        },
      ]);

      await expect(page.getByTestId('acp-assistant-turn')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toHaveCount(1);
      await expect(page.getByTestId('acp-assistant-copy')).toHaveCount(1);
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read grouped file');
      await expect.poll(async () => await page.getByTestId('acp-tool-call-card').evaluate((element) => Boolean(element.closest('[data-testid="acp-assistant-turn"]')))).toBe(true);
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('I will inspect the file.');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('The file is safe.');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('auto-collapses completed tool cards and respects manual override', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'collapse-tool',
          title: 'Collapsible tool',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toHaveAttribute('data-expanded', 'true', { timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      await expect(card).toHaveAttribute('data-expanded', 'false', { timeout: 30_000 });

      await page.getByTestId('acp-tool-toggle').click();
      await expect(card).toHaveAttribute('data-expanded', 'true');

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output after override' } }],
          locations: [],
        },
      ]);

      await page.waitForTimeout(1_200);
      await expect(card).toHaveAttribute('data-expanded', 'true');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ledger-style replayed ACP tool events as historical tool cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-user',
          content: [{ type: 'text', text: 'Replay the tool call' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool',
          title: 'Historical tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'historical output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'history-assistant',
          content: [{ type: 'text', text: 'Historical answer' }],
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toContainText('Historical tool');
      await expect(card).toHaveAttribute('data-expanded', 'false');
      await page.getByTestId('acp-tool-toggle').click();
      await expect(card).toHaveAttribute('data-expanded', 'true');
      await expect(card).toContainText('historical output');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Historical answer');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hydrates historical image-generation completions from transcript history when ACP replay omits them', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'history', { sessionKey: MAIN_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            messages: [
              {
                id: 'transcript-image-start',
                role: 'toolresult',
                toolName: 'image_generate',
                toolCallId: 'history-image-tool',
                content: `Background task started for image generation (${IMAGE_TASK_ID})`,
                details: { taskId: IMAGE_TASK_ID },
              },
              {
                id: 'transcript-image-complete',
                role: 'assistant',
                content: `Here is the generated image.\nMEDIA:${GENERATED_IMAGE_PATH}`,
              },
            ],
          },
          [stableStringify(['media', 'thumbnails', {
            paths: [{ filePath: GENERATED_IMAGE_PATH, mimeType: 'image/png' }],
          }])]: {
            [GENERATED_IMAGE_PATH]: { preview: GENERATED_IMAGE_PREVIEW, fileSize: 128 },
          },
          [stableStringify(['media', 'saveImage', {
            base64: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            defaultFileName: 'generated-image.png',
          }])]: {
            success: true,
            savedPath: '/tmp/generated-image.png',
          },
        },
      });
      await installMediaSaveRecorder(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-image-user',
          content: [{ type: 'text', text: 'Generate an image' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-image-tool',
          title: 'Generate image',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${IMAGE_TASK_ID})` } }],
          locations: [],
        },
      ]);

      const page = await openChat(app);
      await page.evaluate(() => {
        class TestClipboardItem {
          readonly items: Record<string, Blob>;
          constructor(items: Record<string, Blob>) {
            this.items = items;
          }
        }
        Object.defineProperty(window, 'ClipboardItem', { value: TestClipboardItem, configurable: true });
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            write: (items: unknown[]) => {
              const first = items[0] as { items?: Record<string, Blob> } | undefined;
              (window as unknown as { __imageClipboardTypes?: string[] }).__imageClipboardTypes = Object.keys(first?.items ?? {});
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      });

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Generate image');
      await expect(page.getByText('Generated image is ready.')).toBeVisible({ timeout: 30_000 });
      const imagePart = page.getByTestId('acp-image-part');
      const image = imagePart.locator('img');
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', GENERATED_IMAGE_PREVIEW);
      await imagePart.hover();
      await expect(page.getByTestId('acp-image-copy')).toBeVisible();
      await expect(page.getByTestId('acp-image-save')).toBeVisible();

      await page.getByTestId('acp-image-copy').click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __imageClipboardTypes?: string[] }).__imageClipboardTypes ?? [])).toEqual(['image/png']);

      await page.getByTestId('acp-image-save').click();
      await expect.poll(async () => await getRecordedMediaSaveImagePayloads(app)).toEqual([{
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        defaultFileName: 'generated-image.png',
      }]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not synthesize tool cards for transcript fallback text replay', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Old transcript prompt' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Transcript text mentions tool_call but has no structured tool event.' },
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Transcript text mentions tool_call')).toBeVisible();
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts on a new empty chat instead of selecting a heartbeat-only ClawX session', async ({ launchElectronApp }) => {
    const now = 1711111111111;
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'ClawX',
                workspacePath: MAIN_WORKSPACE,
                lastMessagePreview: '[OpenClaw heartbeat poll]',
                updatedAt: new Date(now).toISOString(),
              }],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });
      await installAcpLoadRecorderMock(app);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => {
        const loadSessionKeys = await getRecordedAcpLoadSessionKeys(app);
        return loadSessionKeys.some((sessionKey) => /^agent:main:session-/.test(sessionKey));
      }, { timeout: 30_000 }).toBe(true);
      const loadSessionKeys = await getRecordedAcpLoadSessionKeys(app);
      expect(loadSessionKeys).not.toContain(MAIN_SESSION_KEY);
      await expect(page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`)).toHaveCount(0);
      await expect(page.getByText('[OpenClaw heartbeat poll]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the composer Zoomies indicator only while sending', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptDeferredMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-zoomies')).toHaveCount(0);

      await page.getByTestId('chat-composer-input').fill('Hold the send state');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-composer-working-indicator')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-zoomies')).toBeVisible();

      await resolveDeferredAcpPrompt(app);
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-zoomies')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps a blank new chat interactive after a recoverable initial ACP load failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, updatedAt: new Date().toISOString() }],
            },
          },
        },
        hostApi: baseHostApiMocks({
          success: false,
          error: "Error invoking remote method 'host:invoke': reply was never sent",
        }),
      });

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-error-banner')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps recoverable target-agent prompt failures visible after switching sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const error = "Error invoking remote method 'host:invoke': reply was never sent";

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, updatedAt: new Date().toISOString() },
                { key: REVIEWER_SESSION_KEY, displayName: 'reviewer', workspacePath: REVIEWER_WORKSPACE, updatedAt: new Date().toISOString() },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: REVIEWER_SESSION_KEY, cwd: REVIEWER_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: REVIEWER_SESSION_KEY, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['sessions', 'summaries', { sessionKeys: [MAIN_SESSION_KEY, REVIEWER_SESSION_KEY] }])]: {
            summaries: [
              { sessionKey: MAIN_SESSION_KEY, workspacePath: MAIN_WORKSPACE },
              { sessionKey: REVIEWER_SESSION_KEY, workspacePath: REVIEWER_WORKSPACE },
            ],
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'main',
                    workspace: MAIN_WORKSPACE,
                    mainSessionKey: MAIN_SESSION_KEY,
                  },
                  {
                    id: 'reviewer',
                    name: 'reviewer',
                    workspace: REVIEWER_WORKSPACE,
                    mainSessionKey: REVIEWER_SESSION_KEY,
                    modelDisplay: 'mock-model',
                  },
                ],
              },
            },
          },
        },
      });
      await installAcpPromptFailureMock(app, error);

      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-session-group-%2Fworkspace%2Freviewer')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-agent').click();
      await page.getByRole('button', { name: 'reviewer mock-model' }).click();
      await page.getByTestId('chat-composer-input').fill('Trigger target send failure');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('acp-error-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-error-banner')).toContainText(error);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides heartbeat-only ClawX sessions from the sidebar without hiding normal sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const updatedAt = new Date().toISOString();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                {
                  key: 'agent:main:heartbeat',
                  displayName: 'ClawX',
                  lastMessagePreview: '[OpenClaw heartbeat poll]',
                  updatedAt,
                },
                {
                  key: 'agent:main:session-1710000000000',
                  displayName: 'ClawX',
                  derivedTitle: 'ClawX',
                  lastMessagePreview: 'Summarize the repository structure',
                  updatedAt,
                },
              ],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await openChat(app);

      await expect(page.getByTestId(defaultWorkspaceSessionGroupTestId())).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar-session-agent:main:heartbeat')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-session-agent:main:session-1710000000000')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
