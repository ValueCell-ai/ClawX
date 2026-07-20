import type { ElectronApplication, Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import {
  closeElectronApp,
  expect,
  getRecordedLegacyIpcInvocations,
  getStableWindow,
  installAttachmentHostFixture,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const OTHER_SESSION_KEY = 'agent:main:other';
const PROMPT = 'Create the budget spreadsheet';
const REPLY = 'This is the budget_sample.xlsx file in the current directory.';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Category', 'Budget'],
    ['Operations', 1200],
  ]), 'Budget');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function reportedFlowUpdates(): AcpSessionUpdate[] {
  return [{
    sessionUpdate: 'agent_message',
    messageId: 'budget-reply',
    content: [{ type: 'text', text: REPLY }],
  }];
}

function userUpdate(messageId: string, text: string): AcpSessionUpdate {
  return {
    sessionUpdate: 'user_message',
    messageId,
    content: [{ type: 'text', text }],
  };
}

function resourceUpdate(input: {
  messageId: string;
  uri: string;
  name: string;
  mimeType: string;
  text?: string;
}): AcpSessionUpdate {
  return {
    sessionUpdate: 'agent_message',
    messageId: input.messageId,
    content: [
      ...(input.text ? [{ type: 'text', text: input.text }] : []),
      {
        type: 'resource_link',
        uri: input.uri,
        name: input.name,
        mimeType: input.mimeType,
      },
    ],
  };
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

test.describe('ACP media attachments', () => {
  test('renders user image thumbnails and actionable file paths', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const imageBytes = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ));
      const imagePath = await fixture.createWorkspaceFile('uploads/photo.png', imageBytes);
      const notesPath = await fixture.createWorkspaceFile('uploads/notes.txt', 'Preview this user attachment.');
      const displayImagePath = '/Users/test/Pictures/photo.png';
      const displayNotesPath = '/Users/test/Documents/a/very/long/path/notes.txt';
      await fixture.registerStagedAttachment('stage-photo', imagePath, displayImagePath);
      await fixture.registerStagedAttachment('stage-notes', notesPath, displayNotesPath);
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [{
        sessionUpdate: 'user_message',
        messageId: 'user-attachments',
        content: [
          { type: 'text', text: 'Review these files.' },
          {
            type: 'image',
            uri: imagePath,
            data: Buffer.from(imageBytes).toString('base64'),
            mimeType: 'image/png',
            _meta: { clawx: { stagingId: 'stage-photo', fileName: 'photo.png' } },
          },
          {
            type: 'resource_link',
            uri: notesPath,
            name: 'notes.txt',
            mimeType: 'text/plain',
            _meta: { clawx: { stagingId: 'stage-notes' } },
          },
        ],
      }]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const userMessage = page.getByTestId('acp-user-message');
      await expect(userMessage.getByText('Review these files.')).toBeVisible({ timeout: 30_000 });
      const thumbnail = page.getByTestId('acp-user-image-attachment');
      await expect(thumbnail).toBeVisible();
      await expect(thumbnail).toHaveAttribute('alt', 'photo.png');
      const [bubbleBox, thumbnailBox] = await Promise.all([
        userMessage.locator('.bg-brand').first().boundingBox(),
        thumbnail.locator('..').boundingBox(),
      ]);
      expect(bubbleBox).not.toBeNull();
      expect(thumbnailBox).not.toBeNull();
      expect(Math.abs((bubbleBox!.x + bubbleBox!.width) - (thumbnailBox!.x + thumbnailBox!.width))).toBeLessThanOrEqual(1);
      await expect(page.getByTestId('acp-user-image-overlay')).toContainText('photo.png');

      const notes = page.getByRole('button', { name: 'Preview notes.txt' });
      await expect(notes).toContainText(displayNotesPath);
      await expect(notes).not.toContainText('text/plain');
      await notes.click();
      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Preview this user attachment.')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await fixture.getHostInvocations()).some((call) => (
        call.module === 'media'
        && call.action === 'thumbnails'
        && Array.isArray(call.payload?.paths)
        && (call.payload.paths as Array<Record<string, unknown>>).some((entry) => (
          (entry.attachmentFileRef as Record<string, unknown> | undefined)?.uri === imagePath
        ))
      ))).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('recovers assistant MEDIA for a user turn with a resource attachment', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const prompt = 'Create the attached-source report';
    const reply = 'The attached-source report is ready.';

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [
          { key: MAIN_SESSION_KEY, title: 'Main session' },
          { key: OTHER_SESSION_KEY, title: 'Other session' },
        ],
      });
      const sourcePath = await fixture.createWorkspaceFile('attached-source.xlsx', workbookBytes());
      const outputPath = await fixture.createWorkspaceFile('attached-output.xlsx', workbookBytes());
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [
        {
          sessionUpdate: 'user_message',
          messageId: 'attached-source-user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'resource_link',
              uri: sourcePath,
              name: 'attached-source.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'attached-source-reply',
          content: [{ type: 'text', text: reply }],
        },
      ]);
      const transcript = [
        {
          role: 'user',
          id: 'attached-source-transcript-user',
          content: `[Working directory: ${fixture.workspaceDir}]\n\n${prompt}\n[Resource link] ${sourcePath}`,
        },
        {
          role: 'assistant',
          id: 'attached-source-transcript-assistant',
          content: `${reply}\nMEDIA:${outputPath}`,
        },
      ];
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      await expect(page.getByText(prompt)).toBeVisible({ timeout: 30_000 });
      await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [transcript]);

      await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();

      await expect(page.getByRole('button').filter({ hasText: 'attached-output.xlsx' })).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('previews the reported live spreadsheet flow and restores one historical card', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [
          { key: MAIN_SESSION_KEY, title: 'Main session' },
          { key: OTHER_SESSION_KEY, title: 'Other session' },
        ],
      });
      const spreadsheetPath = await fixture.createWorkspaceFile('budget_sample.xlsx', workbookBytes());
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);
      await fixture.setPromptUpdates(PROMPT, reportedFlowUpdates());

      const page = await openChat(app);
      await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[
        { role: 'user', id: 'transcript-user-budget', content: PROMPT },
        {
          role: 'assistant',
          id: 'transcript-assistant-budget',
          content: `MEDIA:${spreadsheetPath}\n${REPLY}`,
        },
      ]]);

      await page.getByTestId('chat-composer-input').fill(PROMPT);
      await page.getByTestId('chat-composer-send').click();

      const turn = page.getByTestId('acp-assistant-turn').last();
      const prose = turn.getByText(REPLY);
      const attachment = turn.getByRole('button').filter({ hasText: 'budget_sample.xlsx' });
      await expect(prose).toBeVisible({ timeout: 30_000 });
      await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 2);
      await expect(attachment).toBeVisible();
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
      await expect.poll(async () => prose.evaluate((node, card) => (
        Boolean(node.compareDocumentPosition(card as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      ), await attachment.elementHandle())).toBe(true);

      await attachment.click();
      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('artifact-panel-tab-preview')).toBeVisible();
      await expect(panel.getByText('Operations')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await fixture.getHostInvocations()).some((call) => (
        call.module === 'files'
        && call.action === 'readAttachmentBinary'
        && call.payload?.ref
        && (call.payload.ref as Record<string, unknown>).uri === spreadsheetPath
      ))).toBe(true);

      await fixture.setSessionReplay(MAIN_SESSION_KEY, [
        { sessionUpdate: 'user_message', messageId: 'history-user-budget', content: [{ type: 'text', text: PROMPT }] },
        ...reportedFlowUpdates(),
      ]);
      await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();

      await expect(page.getByRole('button').filter({ hasText: 'budget_sample.xlsx' })).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders native ACP resources without transcript evidence and prefers them over duplicate MEDIA evidence', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [
          { key: MAIN_SESSION_KEY, title: 'Main session' },
          { key: OTHER_SESSION_KEY, title: 'Other session' },
        ],
      });
      const spreadsheetPath = await fixture.createWorkspaceFile('native-budget.xlsx', workbookBytes());
      const replay = [
        userUpdate('native-user', 'Show the native budget'),
        resourceUpdate({
          messageId: 'native-reply',
          uri: spreadsheetPath,
          name: 'Native budget.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          text: 'The native ACP resource is ready.',
        }),
      ];
      await fixture.setSessionReplay(MAIN_SESSION_KEY, replay);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const nativeCard = page.getByRole('button', { name: 'Preview Native budget.xlsx', exact: true });
      await expect(nativeCard).toBeEnabled({ timeout: 30_000 });

      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[
        { role: 'user', id: 'native-transcript-user', content: 'Show the native budget' },
        {
          role: 'assistant',
          id: 'native-transcript-assistant',
          content: `MEDIA:${spreadsheetPath}\nThe native ACP resource is ready.`,
        },
      ]]);
      await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();

      await expect(page.getByRole('button', { name: 'Preview Native budget.xlsx', exact: true })).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Preview native-budget.xlsx', exact: true })).toHaveCount(0);
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('routes ZIP and HTTPS attachments through validated Main system-open operations', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const remoteUrl = 'https://example.test/files/remote-archive.zip';

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const zipPath = await fixture.createOpenClawMediaFile('exports/budget-archive.zip', Uint8Array.from([80, 75, 3, 4]));
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [
        userUpdate('open-user', 'Open the archives'),
        {
          sessionUpdate: 'agent_message',
          messageId: 'open-reply',
          content: [
            { type: 'text', text: 'Both archives are ready.' },
            { type: 'resource_link', uri: zipPath, name: 'budget-archive.zip', mimeType: 'application/zip' },
            { type: 'resource_link', uri: remoteUrl, name: 'remote-archive.zip', mimeType: 'application/zip' },
          ],
        },
      ]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const localCard = page.getByRole('button').filter({ hasText: 'budget-archive.zip' });
      const remoteCard = page.getByRole('button').filter({ hasText: 'remote-archive.zip' });
      await expect(localCard).toBeEnabled({ timeout: 30_000 });
      await expect(remoteCard).toBeEnabled();
      await fixture.clearInvocations();

      await localCard.click();
      await expect.poll(async () => (await fixture.getShellInvocations()).some((call) => (
        call.action === 'openPath' && call.payload?.path === zipPath
      ))).toBe(true);
      await remoteCard.click();
      await expect.poll(async () => (await fixture.getShellInvocations()).some((call) => (
        call.action === 'openExternal' && call.payload?.url === remoteUrl
      ))).toBe(true);
      const hostCalls = await fixture.getHostInvocations();
      expect(hostCalls.filter((call) => call.module === 'files' && call.action === 'openAttachment')).toHaveLength(2);
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('previews outside-workspace paths through attachment host APIs', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const outsidePath = await fixture.createOutsideFile('private.txt', 'not authorized');
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [
        userUpdate('outside-user', 'Show the private file'),
        resourceUpdate({
          messageId: 'outside-reply',
          uri: outsidePath,
          name: 'private.txt',
          mimeType: 'text/plain',
          text: 'The requested path is not in the workspace.',
        }),
      ]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const outsideCard = page.getByRole('button', { name: 'Preview private.txt', exact: true });
      await expect(outsideCard).toBeEnabled({ timeout: 30_000 });
      await expect(outsideCard).toContainText(outsidePath);
      const calls = await fixture.getHostInvocations();
      expect(calls.some((call) => (
        call.module === 'files'
        && call.action === 'resolveAttachment'
        && call.payload?.ref
        && (call.payload.ref as Record<string, unknown>).uri === outsidePath
      ))).toBe(true);
      await fixture.clearInvocations();

      await outsideCard.click();
      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText('not authorized')).toBeVisible({ timeout: 30_000 });
      const previewCalls = await fixture.getHostInvocations();
      expect(previewCalls.some((call) => (
        call.module === 'files'
        && call.action === 'readAttachmentText'
        && call.payload?.uri === outsidePath
      ))).toBe(true);
      expect(await fixture.getShellInvocations()).toEqual([]);
      expect((await getRecordedLegacyIpcInvocations(app)).filter((call) => (
        call.channel === 'file:readText'
        || call.channel === 'file:readBinary'
        || call.channel.startsWith('shell:')
      ))).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('drops a delayed 1500 ms transcript retry after switching sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const retryPrompt = 'Prepare the delayed attachment';

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [
          { key: MAIN_SESSION_KEY, title: 'Main session' },
          { key: OTHER_SESSION_KEY, title: 'Other session' },
        ],
      });
      const delayedPath = await fixture.createWorkspaceFile('delayed.txt', 'delayed attachment');
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);
      await fixture.setPromptUpdates(retryPrompt, [{
        sessionUpdate: 'agent_message',
        messageId: 'delayed-reply',
        content: [{ type: 'text', text: 'The attachment will arrive shortly.' }],
      }]);

      const page = await openChat(app);
      await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
      // Drain duplicate startup transcript fetches (Strict Mode / remount) before
      // arming the deferred live retry response, otherwise an extra historical
      // read can consume the deferred slot and make the 1500ms gap look ~0ms.
      await fixture.waitForHistoryQuiet(MAIN_SESSION_KEY);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [
        [],
        {
          deferId: 'delayed-retry',
          messages: [
            { role: 'user', id: 'delayed-transcript-user', content: retryPrompt },
            {
              role: 'assistant',
              id: 'delayed-transcript-assistant',
              content: `MEDIA:${delayedPath}\nThe attachment will arrive shortly.`,
            },
          ],
        },
      ]);
      await fixture.clearHistoryRequestTimes(MAIN_SESSION_KEY);
      await expect(fixture.releaseTranscriptResponse('delayed-retry')).rejects.toThrow(
        'Deferred transcript response is not ready: delayed-retry',
      );
      await page.getByTestId('chat-composer-input').fill(retryPrompt);
      await page.getByTestId('chat-composer-send').click();

      const requestTimes = await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 2, 6_000);
      expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(1_400);
      await fixture.waitForDeferredTranscriptReady('delayed-retry');
      await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await fixture.releaseTranscriptResponse('delayed-retry');
      await fixture.waitForDeferredTranscriptCompleted('delayed-retry');

      await expect(page.getByRole('button').filter({ hasText: 'delayed.txt' })).toHaveCount(0);
      await expect(page.getByText('The attachment will arrive shortly.')).toHaveCount(0);
      expect((await fixture.getHostInvocations()).some((call) => (
        call.module === 'files'
        && (call.action === 'readAttachmentBinary' || call.action === 'openAttachment')
      ))).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('lifts an early attachment after later prose and before file activity', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const earlyPath = await fixture.createWorkspaceFile('early.txt', 'early attachment');
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [
        userUpdate('ordering-user', 'Create the ordered output'),
        resourceUpdate({
          messageId: 'ordering-resource',
          uri: earlyPath,
          name: 'early.txt',
          mimeType: 'text/plain',
        }),
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'ordering-write',
          title: 'Write: activity.txt',
          status: 'in_progress',
          rawInput: { path: 'activity.txt', content: 'created' },
          content: [{ type: 'content', content: { type: 'text', text: 'Writing activity.txt' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'ordering-write',
          title: 'Write: activity.txt',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Write complete' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'ordering-prose',
          content: [{ type: 'text', text: 'The ordered output is complete.' }],
        },
      ]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const turn = page.getByTestId('acp-assistant-turn');
      const prose = turn.getByText('The ordered output is complete.');
      const attachment = turn.getByRole('button').filter({ hasText: 'early.txt' });
      const activity = turn.getByTestId('acp-turn-file-activity');
      await expect(prose).toBeVisible({ timeout: 30_000 });
      await expect(attachment).toBeEnabled();
      await expect(activity).toBeVisible();
      const attachmentHandle = await attachment.elementHandle();
      const activityHandle = await activity.elementHandle();
      if (!attachmentHandle || !activityHandle) throw new Error('Expected ordered attachment and activity elements');
      expect(await prose.evaluate((node, card) => (
        Boolean(node.compareDocumentPosition(card as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      ), attachmentHandle)).toBe(true);
      expect(await attachment.evaluate((node, summary) => (
        Boolean(node.compareDocumentPosition(summary as Node) & Node.DOCUMENT_POSITION_FOLLOWING)
      ), activityHandle)).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
