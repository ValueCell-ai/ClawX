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
  app: Awaited<ReturnType<typeof import('./fixtures/electron').launchElectronApp>>,
  messages: Array<{ role: string; content: string; timestamp: number }>,
) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: SESSION_KEY, displayName: 'main' }],
        },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages },
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
}

test.describe('ClawX chat question directory', () => {
  test('shows a toolbar button that opens a clickable in-conversation question directory', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installQuestionDirectoryMocks(app, seededHistory);

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

      const toggle = page.getByTestId('chat-question-directory-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();

      const directory = page.getByTestId('chat-question-directory');
      await expect(directory).toBeVisible({ timeout: 30_000 });
      await expect(directory).toContainText('Question directory');
      await expect(directory).toContainText('First question: summarize the market opening.');
      await expect(directory).toContainText('Fourth question: prepare the final action plan.');
      await expect(directory.locator('button')).toHaveCount(4);

      await page.getByTestId('chat-question-directory-item-6').click();
      await expect(page.getByTestId('chat-message-6')).toBeInViewport();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('scrolls the question directory to show the latest question', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installQuestionDirectoryMocks(app, longQuestionDirectoryHistory);

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
      await page.getByTestId('chat-question-directory-toggle').click();

      const directory = page.getByTestId('chat-question-directory');
      await expect(directory).toBeVisible({ timeout: 30_000 });
      await expect(directory).toContainText('15');

      const lastItem = page.getByTestId(`chat-question-directory-item-${longQuestionDirectoryHistory.length - 2}`);
      await expect(lastItem).toBeVisible();
      await expect(lastItem).toContainText(latestQuestion);
      await expect(lastItem).toBeInViewport();
    } finally {
      await closeElectronApp(app);
    }
  });
});
