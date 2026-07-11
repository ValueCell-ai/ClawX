import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const longAnswer = [
  'This answer intentionally contains enough text to make the chat scrollable in the Electron window.',
  'It gives the question directory a meaningful target to jump to when the user selects an entry.',
  'The content itself is not important; the test only verifies that the in-chat question outline remains visible and clickable.',
].join(' ');

const seededHistory = [
  { role: 'user', content: 'First question: summarize the market opening.', timestamp: 1000 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1001 },
  { role: 'user', content: 'Second question: list the strongest sectors.', timestamp: 1002 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1003 },
  { role: 'user', content: 'Third question: explain notable risks.', timestamp: 1004 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1005 },
  { role: 'user', content: 'Fourth question: prepare the final action plan.', timestamp: 1006 },
  { role: 'assistant', content: 'Here is the final action plan.', timestamp: 1007 },
];

const latestQuestion = '给我生成一只哈密瓜';

const longQuestionDirectoryHistory = [
  ...Array.from({ length: 14 }, (_, idx) => ([
    { role: 'user', content: `Question ${idx + 1}: generate an image.`, timestamp: 2000 + idx * 2 },
    { role: 'assistant', content: `Answer ${idx + 1}.`, timestamp: 2001 + idx * 2 },
  ])).flat(),
  { role: 'user', content: latestQuestion, timestamp: 3000 },
  { role: 'assistant', content: 'Here is the cantaloupe image.', timestamp: 3001 },
];

async function installQuestionDirectoryMocks(
  app: ElectronApplication,
) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
        },
      },
    },
    hostApi: {
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: MAIN_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: DEFAULT_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
        success: true,
        generation: 1,
      },
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
              agents: [{ id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: SESSION_KEY }],
            },
          },
        },
    },
  });
}

function messagesToAcpUpdates(messages: Array<{ role: string; content: string }>): AcpSessionUpdate[] {
  return messages.map((message, index) => ({
    sessionUpdate: message.role === 'user' ? 'user_message' : 'agent_message',
    messageId: `question-directory-${index}`,
    content: [{ type: 'text', text: message.content }],
  }));
}

async function emitAcpSessionUpdates(app: ElectronApplication, updates: AcpSessionUpdate[]) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
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
    },
    { sessionKey: SESSION_KEY, updates },
  );
}

test.describe('ClawX chat question directory', () => {
  test('opens the ACP question directory for seeded history', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installQuestionDirectoryMocks(app);

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1600, height: 900 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, messagesToAcpUpdates(seededHistory));
      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });

      const toggle = page.getByTestId('chat-question-directory-toggle');
      await expect(toggle).toBeEnabled();
      await toggle.click();

      const directory = page.getByTestId('chat-question-directory');
      await expect(directory).toBeVisible();
      await expect(directory).toContainText('Question directory');
      await expect(directory.getByTestId(/^chat-question-directory-item-/)).toHaveCount(4);
      await expect(directory).toContainText('First question: summarize the market opening.');
      await expect(directory).toContainText('Second question: list the strongest sectors.');
      await expect(directory).toContainText('Third question: explain notable risks.');
      await expect(directory).toContainText('Fourth question: prepare the final action plan.');

      const userMessageAnchorIds = [
        'acp-user-message-question-directory-0:0',
        'acp-user-message-question-directory-2:0',
        'acp-user-message-question-directory-4:0',
        'acp-user-message-question-directory-6:0',
      ];
      for (const id of userMessageAnchorIds) {
        await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
      }

      const firstUserMessage = page.locator('[id="acp-user-message-question-directory-0:0"]');
      await expect(firstUserMessage).not.toBeInViewport();
      await page.getByTestId('chat-question-directory-item-question-directory-0:0').click();
      await expect(firstUserMessage).toBeInViewport();
      await expect(page.getByTestId('acp-user-message')).toHaveCount(4);
      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline.getByText('First question: summarize the market opening.')).toBeVisible();
      await expect(timeline.getByText('Fourth question: prepare the final action plan.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens the restored question directory with the latest ACP question in long history', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installQuestionDirectoryMocks(app);

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1600, height: 900 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, messagesToAcpUpdates(longQuestionDirectoryHistory));
      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-user-message')).toHaveCount(15);
      await expect(page.getByText(latestQuestion, { exact: true })).toBeVisible();
      const toggle = page.getByTestId('chat-question-directory-toggle');
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect(page.getByTestId('chat-question-directory')).toContainText(latestQuestion);
    } finally {
      await closeElectronApp(app);
    }
  });
});
