import type { ElectronApplication, Page } from '@playwright/test';
import {
  clearRecordedFileAccessInvocations,
  closeElectronApp,
  expect,
  getRecordedHostInvocations,
  getRecordedLegacyIpcInvocations,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const OTHER_SESSION_KEY = 'agent:main:other';
const WORKSPACE = '/workspace';
const SESSIONS_LIST_PAYLOAD = { includeDerivedTitles: true, includeLastMessage: true };

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };
type SessionFixture = { key: string; title: string; updates?: AcpSessionUpdate[] };
type AcpEventRecord = {
  sessionKey: string;
  generation: number;
  historical: boolean;
  update: AcpSessionUpdate;
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function user(messageId: string, text: string): AcpSessionUpdate {
  return { sessionUpdate: 'user_message', messageId, content: [{ type: 'text', text }] };
}

function toolSequence(input: {
  id: string;
  title: string;
  rawInput?: Record<string, unknown>;
  finalStatus?: 'completed' | 'failed';
}): AcpSessionUpdate[] {
  return [
    {
      sessionUpdate: 'tool_call',
      toolCallId: input.id,
      title: input.title,
      status: 'in_progress',
      ...(input.rawInput === undefined ? {} : { rawInput: input.rawInput }),
      content: [{ type: 'content', content: { type: 'text', text: `${input.title} started` } }],
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: input.id,
      status: input.finalStatus ?? 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `${input.title} finished` } }],
    },
  ];
}

function writeSequence(id: string, path: string, content: string): AcpSessionUpdate[] {
  return toolSequence({ id, title: `Write: ${path}`, rawInput: { path, content } });
}

function editSequence(id: string, path: string, oldText: string, newText: string): AcpSessionUpdate[] {
  return toolSequence({ id, title: `Edit: ${path}`, rawInput: { path, oldText, newText } });
}

function patchSequence(id: string, patch: string): AcpSessionUpdate[] {
  return toolSequence({ id, title: 'apply_patch: workspace files', rawInput: { input: patch } });
}

async function installFileActivityMocks(app: ElectronApplication, options: {
  sessions?: SessionFixture[];
  liveByPrompt?: Record<string, AcpSessionUpdate[]>;
  liveDelayMs?: number;
  scopedRead?: Record<string, unknown>;
  scopedReadError?: string;
}) {
  const now = Date.now();
  const sessions = options.sessions ?? [{ key: MAIN_SESSION_KEY, title: 'Main session' }];
  const settings = {
    language: 'en',
    setupComplete: true,
    chatWorkspacePath: WORKSPACE,
    recentWorkspacePaths: [WORKSPACE],
  };
  const hostApi: Record<string, unknown> = {
    [stableStringify(['settings', 'getAll', null])]: settings,
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', workspace: WORKSPACE, mainSessionKey: MAIN_SESSION_KEY }],
    },
    [stableStringify(['files', 'resolveWorkspaceContext', {
      workspaceRoot: WORKSPACE,
      executionCwd: WORKSPACE,
    }])]: { ok: true, workspaceRoot: WORKSPACE, executionCwd: WORKSPACE },
    [stableStringify(['sessions', 'summaries', { sessionKeys: sessions.map((session) => session.key) }])]: {
      summaries: sessions.map((session, index) => ({
        sessionKey: session.key,
        firstUserText: session.title,
        lastTimestamp: now - index,
        workspacePath: WORKSPACE,
      })),
    },
  };
  for (const [relativePath, response] of Object.entries(options.scopedRead ?? {})) {
    hostApi[stableStringify(['files', 'readWorkspaceText', { workspaceRoot: WORKSPACE, relativePath }])] = response;
  }
  const nativePlatform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const liveFileRef = { workspaceRoot: WORKSPACE, relativePath: 'src/live.ts' };
  hostApi[stableStringify(['files', 'listWorkspaceOpenHandlers', liveFileRef])] = {
    ok: true,
    platform: nativePlatform,
    handlers: nativePlatform === 'linux'
      ? []
      : [{ handlerId: 'opaque-test-reader', name: 'Test Reader', isDefault: true }],
  };
  hostApi[stableStringify(['files', 'openWorkspaceWith', {
    ref: liveFileRef,
    handlerId: 'opaque-test-reader',
  }])] = { ok: true };
  hostApi[stableStringify(['files', 'revealWorkspaceFile', liveFileRef])] = { ok: true };
  const scopedReadKey = stableStringify(['files', 'readWorkspaceText', {
    workspaceRoot: WORKSPACE,
    relativePath: 'blocked.ts',
  }]);

  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: now },
    gatewayRpc: {
      [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
        success: true,
        result: {
          sessions: sessions.map((session, index) => ({
            key: session.key,
            displayName: session.title,
            derivedTitle: session.title,
            workspacePath: WORKSPACE,
            updatedAt: new Date(now - index).toISOString(),
          })),
        },
      },
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: sessions.map((session, index) => ({
            key: session.key,
            displayName: session.title,
            derivedTitle: session.title,
            workspacePath: WORKSPACE,
            updatedAt: new Date(now - index).toISOString(),
          })),
        },
      },
      [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: [] },
      },
    },
    hostApi,
    hostApiErrors: options.scopedReadError ? { [scopedReadKey]: options.scopedReadError } : undefined,
    recordHostInvocations: true,
    recordLegacyIpcInvocations: true,
  });

  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type Handler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const original = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers?.get('host:invoke');
    const globals = globalThis as unknown as { __fileActivityAcpEvents?: AcpEventRecord[] };
    globals.__fileActivityAcpEvents = [];
    let generation = 0;
    let activeSessionKey = '';
    const replayBySession = new Map((payload.sessions as SessionFixture[]).map((session) => [session.key, session.updates ?? []]));
    const sendUpdates = (sessionKey: string, generation: number, historical: boolean, updates: AcpSessionUpdate[]) => {
      for (const update of updates) {
        globals.__fileActivityAcpEvents?.push({ sessionKey, generation, historical, update });
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey,
            generation,
            historical,
            notification: { sessionId: sessionKey, update },
          });
        }
      }
    };

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (request.module === 'chat' && request.action === 'loadAcpSession') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        generation += 1;
        activeSessionKey = sessionKey;
        sendUpdates(sessionKey, generation, true, replayBySession.get(sessionKey) ?? []);
        return { id: request.id, ok: true, data: { success: true, generation } };
      }
      if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        const promptGeneration = generation;
        const message = String(request.payload?.message ?? '');
        const updates = (payload.liveByPrompt as Record<string, AcpSessionUpdate[]>)[message] ?? [];
        if (sessionKey === activeSessionKey) {
          setTimeout(() => sendUpdates(sessionKey, promptGeneration, false, updates), payload.liveDelayMs);
        }
        return { id: request.id, ok: true, data: { success: true, generation: promptGeneration } };
      }
      return original?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, { sessions, liveByPrompt: options.liveByPrompt ?? {}, liveDelayMs: options.liveDelayMs ?? 0 });
}

async function getRecordedAcpEvents(app: ElectronApplication): Promise<AcpEventRecord[]> {
  return await app.evaluate(async ({ app: _app }) => (
    (globalThis as unknown as { __fileActivityAcpEvents?: AcpEventRecord[] }).__fileActivityAcpEvents ?? []
  ));
}

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

async function sendPrompt(page: Page, prompt: string) {
  await page.getByTestId('chat-composer-input').fill(prompt);
  await page.getByTestId('chat-composer-send').click();
}

async function openChanges(page: Page) {
  await page.getByTestId('chat-toolbar-workspace').click();
  const panel = page.getByTestId('artifact-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('artifact-panel-tab-changes').click();
  return panel;
}

test.describe('ClawX chat file changes', () => {
  test('opens HTML file activity in the Web Browser from Open with', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: {
          'Create HTML': writeSequence('write-html', 'site/demo.html', '<h1>Demo</h1>'),
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Create HTML');

      const openWith = page.getByRole('button', { name: 'Open site/demo.html with' });
      await expect(openWith).toBeVisible({ timeout: 30_000 });
      await openWith.click();
      const menu = page.getByTestId('acp-attachment-open-with-menu');
      await expect(menu).toBeVisible();
      const browserItem = page.getByTestId('acp-file-open-in-built-in-browser');
      await expect(menu).toContainText('Open in built-in browser');
      await expect(page.getByRole('menuitem').first()).toHaveAttribute(
        'data-testid',
        'acp-file-open-in-built-in-browser',
      );
      await browserItem.click();

      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('artifact-panel-tab-web-browser')).toHaveClass(/bg-foreground\/10/);
      await expect(page.getByTestId('web-browser-host')).toHaveAttribute('aria-hidden', 'false');
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((request) => (
        request.module === 'webBrowser'
        && request.action === 'navigate'
        && request.payload?.url === 'file:///workspace/site/demo.html'
      ))).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders a live completed Write with counts, scoped Preview, and a session record', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: { 'Create the file': writeSequence('write-live', 'src/live.ts', 'one\ntwo\n') },
        scopedRead: {
          'src/live.ts': { ok: true, content: 'one\ntwo\n', size: 8, mimeType: 'text/typescript', readOnly: true },
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Create the file');

      await expect(page.getByTestId('acp-file-button')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('acp-file-button')).toHaveAccessibleName('Created src/live.ts');
      await expect(page.getByTestId('acp-file-summary-row')).toContainText('+2');
      await expect(page.getByTestId('acp-file-summary-row')).toContainText('-0');

      const openWith = page.getByRole('button', { name: 'Open src/live.ts with' });
      await openWith.click();
      await expect(page.getByTestId('acp-attachment-open-with-menu')).toBeVisible();
      if (process.platform !== 'linux') {
        await page.getByRole('menuitem', { name: 'Test Reader' }).click();
        await expect.poll(async () => (await getRecordedHostInvocations(app)).some((request) => (
          request.module === 'files'
          && request.action === 'openWorkspaceWith'
          && request.payload?.handlerId === 'opaque-test-reader'
          && request.payload?.ref && typeof request.payload.ref === 'object'
          && (request.payload.ref as Record<string, unknown>).relativePath === 'src/live.ts'
        ))).toBe(true);
        await openWith.click();
      }
      const revealLabel = process.platform === 'darwin'
        ? 'Show in Finder'
        : process.platform === 'win32'
          ? 'Show in File Explorer'
          : 'Show in file manager';
      await page.getByRole('menuitem', { name: revealLabel }).click();
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((request) => (
        request.module === 'files'
        && request.action === 'revealWorkspaceFile'
        && request.payload?.relativePath === 'src/live.ts'
      ))).toBe(true);

      await page.getByTestId('acp-file-button').click();

      const panel = page.getByTestId('artifact-panel');
      await expect(panel.getByRole('heading', { name: 'live.ts' })).toBeVisible();
      await expect(panel.getByText('File changes (1)')).not.toBeVisible();
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((request) => (
        request.module === 'files'
        && request.action === 'readWorkspaceText'
        && request.payload?.relativePath === 'src/live.ts'
      ))).toBe(true);

      await panel.getByTestId('artifact-panel-tab-changes').click();
      await expect(panel.getByText('File changes (1)')).toBeVisible();
      const changedFile = panel.getByTestId('acp-change-file-src/live.ts');
      await expect(changedFile).toBeVisible();
      await expect(changedFile.locator('span[aria-hidden="true"] > svg')).toHaveCount(1);
      await expect(panel.getByTestId('acp-change-activity-0')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders declared Edit and apply-patch fragments from live completions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/patched.ts',
      '@@',
      '-patch before',
      '+patch after',
      '@@ later',
      '-second before',
      '+second after',
      '*** End Patch',
    ].join('\n');
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: {
          'Edit two files': [
            ...editSequence('edit-live', 'src/edited.ts', 'edit before', 'edit after'),
            ...patchSequence('patch-live', patch),
          ],
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Edit two files');

      await expect(page.getByTestId('acp-file-button')).toHaveCount(2, { timeout: 30_000 });
      await expect(page.getByTestId('acp-attachment-open-with-trigger')).toHaveCount(2);
      const panel = await openChanges(page);
      await expect(panel.getByTestId('acp-change-file-group')).toHaveCount(2);
      await expect(panel.getByTestId('monaco-diff-viewer')).toHaveCount(2);
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'edit before' })).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'edit after' })).toBeVisible();
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'patch before' })).toBeVisible();
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'patch after' })).toBeVisible();
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'second before' })).toBeVisible();
      await expect(panel.locator('.monaco-editor').filter({ hasText: 'second after' })).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps failed supported and completed unsupported tools ordinary with no file activity', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: {
          'Run non-file activity': [
            ...toolSequence({
              id: 'failed-write',
              title: 'Write: failed.ts',
              rawInput: { path: 'failed.ts', content: 'nope' },
              finalStatus: 'failed',
            }),
            ...toolSequence({
              id: 'unsupported-read',
              title: 'Read: unsupported.ts',
              rawInput: { path: 'unsupported.ts' },
            }),
          ],
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Run non-file activity');

      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(2, { timeout: 30_000 });
      const failedWrite = page.getByTestId('acp-tool-call-card').filter({ hasText: 'Write: failed.ts' });
      const unsupportedRead = page.getByTestId('acp-tool-call-card').filter({ hasText: 'Read: unsupported.ts' });
      await expect(failedWrite).toContainText('Failed');
      await expect(unsupportedRead).toContainText('Completed');
      await expect(page.getByTestId('acp-turn-file-activity')).toHaveCount(0);
      await expect(page.getByTestId('acp-file-button')).toHaveCount(0);
      await expect(page.getByTestId('acp-file-summary-row')).toHaveCount(0);

      const panel = await openChanges(page);
      await expect(panel.getByText('This session has no file changes yet.')).toBeVisible();
      await expect(panel.getByTestId('acp-change-file-group')).toHaveCount(0);
      await expect(panel.getByText(/File changes \(/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens Changes instead of Preview from a deleted file button', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: {
          'Delete the file': patchSequence(
            'delete-live',
            '*** Begin Patch\n*** Delete File: src/deleted.ts\n*** End Patch',
          ),
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Delete the file');
      const fileButton = page.getByTestId('acp-file-button');
      await expect(fileButton).toHaveAccessibleName('Deleted src/deleted.ts', { timeout: 30_000 });
      await expect(page.getByTestId('acp-attachment-open-with-trigger')).toHaveCount(0);
      await fileButton.click();

      const panel = page.getByTestId('artifact-panel');
      await expect(panel.getByTestId('acp-change-file-src/deleted.ts')).toBeVisible();
      await expect(panel.getByText('No file selected')).not.toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves both fragment sections when two live turns edit one path', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: {
          'First edit': editSequence('edit-first', 'src/shared.ts', 'first old', 'first new'),
          'Second edit': editSequence('edit-second', 'src/shared.ts', 'second old', 'second new'),
        },
      });
      const page = await openChat(app);
      await sendPrompt(page, 'First edit');
      await expect(page.getByTestId('acp-file-button')).toHaveCount(1, { timeout: 30_000 });
      await sendPrompt(page, 'Second edit');
      await expect(page.getByTestId('acp-file-button')).toHaveCount(2, { timeout: 30_000 });

      const panel = await openChanges(page);
      await expect(panel.getByTestId('acp-change-file-group')).toHaveCount(1);
      await expect(panel.locator('[data-testid^="acp-change-activity-"]')).toHaveCount(2);
      await expect(panel.getByTestId('monaco-diff-viewer')).toHaveCount(2);
      await expect(panel.getByText('Change 1')).toBeVisible();
      await expect(panel.getByText('Change 2')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('restores the full ledger after switching away and replaying the session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const replay = [
      user('replay-user-one', 'First historical edit'),
      ...editSequence('replay-first', 'src/replayed.ts', 'one old', 'one new'),
      user('replay-user-two', 'Second historical edit'),
      ...editSequence('replay-second', 'src/replayed.ts', 'two old', 'two new'),
    ];
    try {
      await installFileActivityMocks(app, {
        sessions: [
          { key: MAIN_SESSION_KEY, title: 'Ledger session', updates: replay },
          { key: OTHER_SESSION_KEY, title: 'Other session', updates: [user('other-user', 'Other history')] },
        ],
        liveByPrompt: {
          'Delayed generation check': writeSequence('delayed-generation', 'src/delayed.ts', 'delayed'),
        },
        liveDelayMs: 1_000,
      });
      const page = await openChat(app);
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-file-button')).toHaveCount(2, { timeout: 30_000 });
      await sendPrompt(page, 'Delayed generation check');
      await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
      await expect(page.getByText('Other history', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-file-button')).toHaveCount(0, { timeout: 30_000 });
      await expect.poll(async () => (await getRecordedAcpEvents(app)).filter(
        (event) => !event.historical && event.sessionKey === MAIN_SESSION_KEY,
      ).length).toBe(2);
      const events = await getRecordedAcpEvents(app);
      const liveGeneration = events.find((event) => !event.historical)?.generation;
      const otherGeneration = events.find((event) => event.historical && event.sessionKey === OTHER_SESSION_KEY)?.generation;
      expect(liveGeneration).toBeLessThan(otherGeneration as number);
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-file-button')).toHaveCount(2, { timeout: 30_000 });

      const panel = await openChanges(page);
      await expect(panel.locator('[data-testid^="acp-change-activity-"]')).toHaveCount(2);
      await expect(panel.getByTestId('monaco-diff-viewer')).toHaveCount(2);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not invent file activity when replay omits raw input', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        sessions: [{
          key: MAIN_SESSION_KEY,
          title: 'Incomplete replay',
          updates: [
            user('missing-input-user', 'Replay incomplete Write'),
            ...toolSequence({ id: 'missing-input', title: 'Write: missing.ts' }),
          ],
        }],
      });
      const page = await openChat(app);

      const missingInputWrite = page.getByTestId('acp-tool-call-card').filter({ hasText: 'Write: missing.ts' });
      await expect(missingInputWrite).toContainText('Completed', { timeout: 30_000 });
      await expect(page.getByTestId('acp-turn-file-activity')).toHaveCount(0);
      const panel = await openChanges(page);
      await expect(panel.getByText('This session has no file changes yet.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows an empty Changes view for New Session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        sessions: [{
          key: MAIN_SESSION_KEY,
          title: 'Changed session',
          updates: [user('changed-user', 'Changed history'), ...writeSequence('changed-write', 'changed.ts', 'changed')],
        }],
      });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-file-button')).toHaveCount(1, { timeout: 30_000 });
      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      const panel = await openChanges(page);
      await expect(panel.getByText('This session has no file changes yet.')).toBeVisible();
      await expect(panel.getByTestId('acp-change-file-group')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows scoped read rejection without invoking unscoped file or shell actions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installFileActivityMocks(app, {
        liveByPrompt: { 'Write blocked file': writeSequence('blocked-write', 'blocked.ts', 'blocked') },
        scopedReadError: 'Scoped file access unavailable',
      });
      const page = await openChat(app);
      await sendPrompt(page, 'Write blocked file');
      await expect(page.getByTestId('acp-file-button')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-toolbar-workspace').click();
      await expect(page.getByTestId('artifact-panel')).toBeVisible();
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((request) => (
        request.module === 'files'
        && request.action === 'listTree'
        && request.payload?.path === WORKSPACE
        && (request.payload?.opts as { includeHidden?: boolean } | undefined)?.includeHidden === true
      ))).toBe(true);
      await clearRecordedFileAccessInvocations(app);
      await page.getByTestId('acp-file-button').click();

      const panel = page.getByTestId('artifact-panel');
      await expect(panel.getByText(/Load failed:.*Scoped file access unavailable/i)).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByRole('button', { name: 'Show in file manager' })).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Open directly' })).toHaveCount(0);
      const invocations = await getRecordedHostInvocations(app);
      expect(invocations).toEqual(expect.arrayContaining([expect.objectContaining({
        module: 'files',
        action: 'readWorkspaceText',
        payload: { workspaceRoot: WORKSPACE, relativePath: 'blocked.ts' },
      })]));
      expect(invocations.filter((request) => (
        (request.module === 'files' && request.action !== 'readWorkspaceText')
        || request.module === 'shell'
      ))).toEqual([]);
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
