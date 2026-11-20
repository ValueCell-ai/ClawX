import type { ElectronApplication, Page } from '@playwright/test';
import type { RawMessage } from '../../shared/chat/types';
import { closeElectronApp, expect, getStableWindow, installAttachmentHostFixture, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const IMAGE_GENERATION_TASK_ID = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
const SECOND_IMAGE_GENERATION_TASK_ID = '1c939d2e-e7ea-480e-9dcf-4080df479fa3';
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ONE_PIXEL_PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;
const ONE_PIXEL_SVG_BASE64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="black"/></svg>').toString('base64');

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function baseHostApiMocks(
  loadResult: Record<string, unknown> = { success: true, generation: 1 },
  overrides: Record<string, unknown> = {},
) {
  return {
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey: MAIN_SESSION_KEY,
      workspaceRoot: MAIN_WORKSPACE,
      cwd: MAIN_WORKSPACE,
    }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey: MAIN_SESSION_KEY,
      workspaceRoot: '/',
      cwd: '/',
    }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey: MAIN_SESSION_KEY,
      workspaceRoot: DEFAULT_WORKSPACE,
      cwd: DEFAULT_WORKSPACE,
    }])]: loadResult,
    [stableStringify(['sessions', 'summaries', { sessionKeys: [MAIN_SESSION_KEY] }])]: { summaries: [] },
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
    ...overrides,
  };
}

function generatedImageHostApiMocks(generatedPath: string, identity: string): Record<string, unknown> {
  const ref = { sessionKey: MAIN_SESSION_KEY, generation: 1, uri: generatedPath };
  return {
    [stableStringify(['files', 'resolveAttachment', {
      ref,
      mimeType: 'image/png',
    }])]: {
      ok: true,
      identity,
      displayName: generatedPath.split('/').at(-1) ?? 'generated.png',
      mimeType: 'image/png',
      size: 67,
      target: { kind: 'local', scope: 'openclaw-media', ref },
    },
    [stableStringify(['media', 'thumbnails', {
      paths: [{ attachmentFileRef: ref, key: identity, mimeType: 'image/png' }],
    }])]: {
      [identity]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
    },
  };
}

async function installAcpChatMocks(
  app: ElectronApplication,
  loadResult: Record<string, unknown> = { success: true, generation: 1 },
  hostApiOverrides: Record<string, unknown> = {},
) {
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
    hostApi: baseHostApiMocks(loadResult, hostApiOverrides),
  });
}

async function emitGatewayChatMessage(
  app: ElectronApplication,
  payload: Record<string, unknown>,
) {
  await app.evaluate(
    async ({ app: _app }, chatPayload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('gateway:chat-message', chatPayload);
      }
    },
    payload,
  );
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  generation = 1,
  historical = false,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: payload.generation,
            ...(payload.historical ? { historical: true } : {}),
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: MAIN_SESSION_KEY, generation, historical, updates },
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

const KITTEN_PROMPT = 'Generate a kitten on a blue windowsill.';
const KITTEN_ACK = 'The kitten image is being generated.';
const KITTEN_CAPTION = 'Here is your kitten.';
const FOLLOWUP_PROMPT = 'What color was the windowsill?';
const FOLLOWUP_REPLY = 'The windowsill was blue.';
const OTHER_SESSION_KEY = 'agent:main:other';
type ReceiptChannel = 'assistant' | 'message tool';

async function kittenGenerationFixture(app: ElectronApplication, receiptChannel: ReceiptChannel) {
  const fixture = await installAttachmentHostFixture(app, {
    inlineSessionReplay: true,
    sessions: [
      { key: MAIN_SESSION_KEY, title: 'Kitten chat' },
      { key: OTHER_SESSION_KEY, title: 'Other chat' },
    ],
  });
  const imagePath = await fixture.createOpenClawMediaFile(
    'tool-image-generation/kitten.png',
    Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
  );
  const taskId = `tool:image_generate:${IMAGE_GENERATION_TASK_ID}`;
  const start = `Background task started for image generation (${taskId}). Do not call image_generate again for this request.`;
  const result = {
    content: [{ type: 'text', text: start }],
    details: { async: true, status: 'started', taskId },
  };
  const dispatch = {
    tool: { id: 'openclaw:core:image_generate', name: 'image_generate', source: 'openclaw' },
    result,
  };
  const dispatchContent = [{ type: 'text', text: JSON.stringify(dispatch, null, 2) }];
  const parentId = 'call_kitten';
  const updates: AcpSessionUpdate[] = [
    {
      sessionUpdate: 'tool_call_update', toolCallId: `tool_call:${parentId}:image_generate:1`, status: 'completed',
      rawOutput: result, content: result.content.map((content) => ({ type: 'content', content })),
    },
    {
      sessionUpdate: 'tool_call_update', toolCallId: parentId, status: 'completed',
      rawOutput: { content: dispatchContent, details: dispatch },
      content: dispatchContent.map((content) => ({ type: 'content', content })),
    },
  ];
  const pending: RawMessage[] = [
    { role: 'user', content: KITTEN_PROMPT },
    {
      // OpenClaw writes camel case to its transcript.
      role: 'toolResult' as RawMessage['role'],
      toolName: 'dispatch_action', toolCallId: parentId, content: dispatchContent, details: dispatch,
    },
  ];
  if (receiptChannel === 'assistant') {
    updates.push({ sessionUpdate: 'agent_message', messageId: 'kitten-ack', content: [{ type: 'text', text: KITTEN_ACK }] });
    pending.push({ role: 'assistant', content: KITTEN_ACK });
  } else {
    const callId = 'call_receipt';
    const input = { action: 'send', message: KITTEN_ACK, final: true };
    const details = {
      status: 'ok', deliveryStatus: 'sent', channel: 'webchat', target: 'current-run', sourceReplyTranscriptOwner: true,
      sourceReplyDeliveryMode: 'message_tool_only', sourceReplySink: 'internal-ui', sourceReply: { text: KITTEN_ACK },
    };
    const content = [{ type: 'text', text: 'Sent reply to the source conversation via internal-ui.' }];
    updates.push({
      sessionUpdate: 'tool_call_update', toolCallId: callId, title: 'message', rawInput: input,
      status: 'completed', rawOutput: { content, details },
    });
    pending.push(
      { role: 'assistant', content: [{ type: 'toolCall', id: callId, name: 'message', arguments: input }] },
      { role: 'toolResult' as RawMessage['role'], toolCallId: callId, toolName: 'message', content, details },
    );
  }
  const trigger = {
    role: 'user' as const,
    display: false,
    provenance: { kind: 'inter_session', sourceTool: 'image_generate', sourceSessionKey: `image_generate:${taskId}` },
    content: [{ type: 'text', text: `A background task completed.\nGenerated media:\nMEDIA:${imagePath}` }],
  };
  const completed: RawMessage[] = [
    ...pending,
    trigger,
    { role: 'assistant', timestamp: 1_790_000_003_000, content: [{ type: 'text', text: `${KITTEN_CAPTION}\nMEDIA:${imagePath}` }] },
  ];
  return { fixture, updates, pending, completed };
}

async function expectKittenPreview(page: Page) {
  const timeline = page.getByTestId('acp-chat-timeline');
  const turn = timeline.getByTestId('acp-assistant-turn').filter({ hasText: KITTEN_ACK });
  const acknowledgment = turn.getByTestId('acp-assistant-message').getByText(KITTEN_ACK, { exact: true });
  const caption = turn.getByText(KITTEN_CAPTION, { exact: true });
  const image = turn.getByRole('img', { name: 'Image' });
  await expect(acknowledgment).toBeVisible();
  await expect(caption).toBeVisible();
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('naturalWidth', 1);
  await expect(acknowledgment.or(caption).or(image)).toHaveText([KITTEN_ACK, KITTEN_CAPTION, '']);
  await expect(timeline.getByTestId('acp-image-part')).toHaveCount(1);
  await expect(page.getByTestId('chat-composer-image-generation-indicator')).toHaveCount(0);
}

test.describe('ClawX chat run state events', () => {
  test('renders ACP tool run-state updates inline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'run-user',
          content: [{ type: 'text', text: 'Run a long task' }],
        },
        {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'run-assistant',
          content: { type: 'text', text: 'Need to inspect a file before answering.' },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-demo',
          title: 'Read /tmp/demo.md',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'Reading /tmp/demo.md' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'read-demo',
          title: 'Read /tmp/demo.md',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Read complete' } }],
          locations: [],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-thought-block')).toContainText('Need to inspect a file before answering.');
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read /tmp/demo.md');
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read complete');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ACP image parts for generated assistant media', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message',
          messageId: 'generated-image',
          content: [
            { type: 'text', text: 'Generated image is ready.' },
            { type: 'image', mimeType: 'image/png', data: ONE_PIXEL_PNG_BASE64 },
          ],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Generated image is ready.')).toBeVisible();
      await expect(page.getByTestId('acp-image-part')).toBeVisible();
      await expect(page.getByTestId('acp-image-part').locator('img')).toBeVisible();
      await expect(page.getByTestId('image-preview-unavailable')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('surfaces ACP tool-delivered image content inline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'puppy-request',
          content: [{ type: 'text', text: 'Generate a puppy image' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'message-tool',
          title: 'Send generated image',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: 'Puppy ready' } },
            { type: 'content', content: { type: 'image', mimeType: 'image/png', data: ONE_PIXEL_PNG_BASE64 } },
          ],
          locations: [],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      const toolCard = page.getByTestId('acp-tool-call-card');
      await expect(toolCard).toContainText('Send generated image');
      if (await toolCard.getAttribute('data-expanded') !== 'true') {
        await toolCard.getByTestId('acp-tool-toggle').click();
      }
      await expect(page.getByText('Puppy ready')).toBeVisible();
      await expect(toolCard.getByTestId('acp-image-part')).toBeVisible();
      await expect(toolCard.getByTestId('acp-image-part').locator('img')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  for (const receiptChannel of ['assistant', 'message tool'] as const) {
    test(`projects OpenClaw image-generation from a delayed dispatch transcript in the open chat (${receiptChannel} receipt)`, async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup: true });
      try {
        const { fixture, updates, pending, completed } = await kittenGenerationFixture(app, receiptChannel);
        await fixture.setPromptUpdates(KITTEN_PROMPT, updates);
        const page = await openChat(app);
        await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
        await fixture.waitForHistoryQuiet(MAIN_SESSION_KEY);
        // The tool acknowledgment can precede on-disk delivery by multiple reads.
        // The background task sends no corresponding completion over ACP.
        await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [pending, pending, { messages: completed, deferId: 'kitten-ready' }]);
        await page.getByTestId('chat-composer-input').fill(KITTEN_PROMPT);
        await page.getByTestId('chat-composer-send').click();
        await expect(page.getByTestId('acp-assistant-message').getByText(KITTEN_ACK, { exact: true })).toBeVisible();
        await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();
        await fixture.waitForDeferredTranscriptReady('kitten-ready', 20_000);
        await expect(page.getByTestId('acp-image-part')).toHaveCount(0);
        await fixture.releaseTranscriptResponse('kitten-ready');
        await expectKittenPreview(page);

        // The next prompt settles from ACP replay, which contains the receipt but no image.
        await fixture.setPromptUpdates(FOLLOWUP_PROMPT, [{
          sessionUpdate: 'agent_message', messageId: 'later-reply', content: [{ type: 'text', text: FOLLOWUP_REPLY }],
        }]);
        await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[
          ...completed,
          { role: 'user', content: FOLLOWUP_PROMPT },
          { role: 'assistant', content: FOLLOWUP_REPLY },
        ]]);
        await fixture.clearHistoryRequestTimes(MAIN_SESSION_KEY);
        await page.getByTestId('chat-composer-input').fill(FOLLOWUP_PROMPT);
        await page.getByTestId('chat-composer-send').click();
        await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
        await expectKittenPreview(page);
        await expect(page.getByTestId('acp-assistant-turn')).toContainText([KITTEN_CAPTION, FOLLOWUP_REPLY]);
      } finally {
        await closeElectronApp(app);
      }
    });

    test(`projects OpenClaw image-generation from a persisted dispatch transcript when reopening the chat (${receiptChannel} receipt)`, async ({ launchElectronApp }) => {
      const app = await launchElectronApp({ skipSetup: true });
      try {
        const { fixture, updates, completed } = await kittenGenerationFixture(app, receiptChannel);
        const page = await openChat(app);
        await fixture.waitForHistoryRequestCount(MAIN_SESSION_KEY, 1);
        await page.getByTestId(`sidebar-session-${OTHER_SESSION_KEY}`).click();
        await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
        await fixture.setSessionReplay(MAIN_SESSION_KEY, [
          { sessionUpdate: 'user_message', messageId: 'kitten-prompt', content: [{ type: 'text', text: KITTEN_PROMPT }] },
          ...updates,
          { sessionUpdate: 'user_message', messageId: 'later-prompt', content: [{ type: 'text', text: FOLLOWUP_PROMPT }] },
          { sessionUpdate: 'agent_message', messageId: 'later-reply', content: [{ type: 'text', text: FOLLOWUP_REPLY }] },
        ]);
        await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[
          ...completed,
          { role: 'user', id: 'later-prompt', content: FOLLOWUP_PROMPT },
          { role: 'assistant', id: 'later-reply', content: FOLLOWUP_REPLY },
        ]]);
        await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
        await expect(page.getByText(FOLLOWUP_REPLY, { exact: true })).toBeVisible();
        await expectKittenPreview(page);
        await expect(page.getByTestId('acp-assistant-turn')).toContainText([KITTEN_CAPTION, FOLLOWUP_REPLY]);
      } finally {
        await closeElectronApp(app);
      }
    });
  }

  test('projects OpenClaw image-generation structured media into ACP Chat previews', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/tmp/openclaw-generated-sky.png';
    const secondGeneratedPath = '/tmp/openclaw-generated-dog.png';

    try {
      await installAcpChatMocks(
        app,
        { success: true, generation: 1 },
        {
          ...generatedImageHostApiMocks(generatedPath, 'e2e-live-generated-image'),
          ...generatedImageHostApiMocks(secondGeneratedPath, 'e2e-second-live-generated-image'),
        },
      );
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${IMAGE_GENERATION_TASK_ID}).`,
            },
          }],
          locations: [],
        },
      ]);
      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Background task started for image generation');
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toContainText('Generating image');
      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toHaveCount(0);
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toContainText('Generating image');

      await emitGatewayChatMessage(app, {
        message: {
          runId: `image_generate:${IMAGE_GENERATION_TASK_ID}:ok`,
          sessionKey: MAIN_SESSION_KEY,
          state: 'final',
          message: {
            role: 'assistant',
            content: [{
              type: 'text',
              text: `Here is the exact sky scene you requested.\n\nMEDIA:${generatedPath}`,
            }],
          },
        },
      });

      await expect(page.getByText('Here is the exact sky scene you requested.')).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      const image = timeline.getByRole('img', { name: 'Image' });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toHaveCount(0);
      await expect(page.getByTestId('image-preview-unavailable')).toHaveCount(0);

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'tool_call_update',
        toolCallId: 'second-image-tool',
        status: 'completed',
        content: [{
          type: 'content',
          content: {
            type: 'text',
            text: `Background task started for image generation (${SECOND_IMAGE_GENERATION_TASK_ID}).`,
          },
        }],
        locations: [],
      }]);
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();
      await expect(page.getByText('Here is the exact sky scene you requested.')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();
      await expect(page.getByText('Here is the exact sky scene you requested.')).toBeVisible();
      await expect(timeline.getByRole('img', { name: 'Image' })).toHaveCount(1);

      await emitGatewayChatMessage(app, {
        message: {
          runId: `image_generate:${SECOND_IMAGE_GENERATION_TASK_ID}:ok`,
          sessionKey: MAIN_SESSION_KEY,
          state: 'final',
          message: {
            role: 'assistant',
            content: [{
              type: 'text',
              text: `Here is the dog image you requested.\n\nMEDIA:${secondGeneratedPath}`,
            }],
          },
        },
      });
      await expect(page.getByText('Here is the dog image you requested.')).toBeVisible();
      await expect(timeline.getByRole('img', { name: 'Image' })).toHaveCount(2);
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('projects OpenClaw image-generation failures as ACP Chat replies', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'tool_call_update',
        toolCallId: 'image-tool',
        status: 'completed',
        content: [{
          type: 'content',
          content: {
            type: 'text',
            text: `Background task started for image generation (${IMAGE_GENERATION_TASK_ID}).`,
          },
        }],
        locations: [],
      }]);
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toBeVisible();

      await emitGatewayChatMessage(app, {
        message: {
          runId: `image_generate:${IMAGE_GENERATION_TASK_ID}:error`,
          sessionKey: MAIN_SESSION_KEY,
          state: 'final',
          message: {
            role: 'assistant',
            content: [{
              type: 'text',
              text: 'Image generation failed because no image model is available.',
            }],
          },
        },
      });

      await expect(page.getByText('Image generation failed because no image model is available.')).toBeVisible();
      await expect(page.getByTestId('chat-composer-image-generation-indicator')).toHaveCount(0);
      await expect(page.getByTestId('acp-image-part')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('replays OpenClaw image-generation previews from historical ACP tool output', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/tmp/openclaw-replayed-sky.png';

    try {
      await installAcpChatMocks(
        app,
        { success: true, generation: 1 },
        generatedImageHostApiMocks(generatedPath, 'e2e-replayed-generated-image'),
      );
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${IMAGE_GENERATION_TASK_ID}).`,
            },
          }],
          locations: [],
        },
      ], 1, true);
      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Background task started for image generation');

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'message-tool',
          status: 'completed',
          rawOutput: {
            details: {
              status: 'ok',
              deliveryStatus: 'sent',
              sourceReplySink: 'internal-ui',
              sourceReply: {
                text: 'Generated image is ready.',
                mediaUrls: [generatedPath],
              },
            },
          },
          locations: [],
        },
      ], 1, true);

      await expect(page.getByText('Generated image is ready.')).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      const image = timeline.getByRole('img', { name: 'Image' });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('replays OpenClaw image-generation previews from historical assistant MEDIA text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png';

    try {
      await installAcpChatMocks(
        app,
        { success: true, generation: 1 },
        generatedImageHostApiMocks(generatedPath, 'e2e-transcript-generated-image'),
      );
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${IMAGE_GENERATION_TASK_ID}).`,
            },
          }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'replayed-image-result',
          content: {
            type: 'text',
            text: `Generated image is ready.\n\nMEDIA:${generatedPath}`,
          },
        },
      ], 1, true);

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Generated image is ready.').first()).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      const image = timeline.getByRole('img', { name: 'Image' });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders a live ACP assistant MEDIA completion after its image-generation task', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/Users/me/.openclaw/media/tool-image-generation/live-steak.png';

    try {
      await installAcpChatMocks(
        app,
        { success: true, generation: 1 },
        generatedImageHostApiMocks(generatedPath, 'e2e-live-generated-image'),
      );
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${IMAGE_GENERATION_TASK_ID}).`,
            },
          }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'live-image-result',
          content: [{
            type: 'text',
            text: `Steak is ready.\n\nMEDIA:${generatedPath}`,
          }],
        },
      ]);

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(page.getByText('Steak is ready.', { exact: true })).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      await expect(timeline.getByRole('img', { name: 'Image' })).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
      await expect(page.getByText(/MEDIA:/)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not render plain MEDIA assistant text without image-generation context', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const untrustedPath = '/tmp/not-trusted.png';

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 }, {
        [stableStringify(['media', 'thumbnails', {
          paths: [{ filePath: untrustedPath, mimeType: 'image/png' }],
        }])]: {
          [untrustedPath]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
        },
        [stableStringify(['media', 'thumbnails', {
          paths: [{ filePath: untrustedPath }],
        }])]: {
          [untrustedPath]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
        },
      });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message',
        messageId: 'plain-media-text',
        content: [{ type: 'text', text: `MEDIA:${untrustedPath}` }],
      }]);

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`MEDIA:${untrustedPath}`)).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toHaveCount(0);
      await expect(timeline.getByRole('img', { name: 'Image' })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ACP SVG image content without legacy MEDIA marker leakage', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const filePath = String.raw`C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;
    const attachmentRef = { sessionKey: MAIN_SESSION_KEY, generation: 1, uri: filePath };

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 }, {
        [stableStringify(['files', 'resolveAttachment', {
          ref: attachmentRef,
          name: 'japan-kansai-4d3n-plan.svg',
          mimeType: 'image/svg+xml',
        }])]: {
          ok: true,
          identity: 'e2e-windows-svg',
          displayName: 'japan-kansai-4d3n-plan.svg',
          mimeType: 'image/svg+xml',
          size: 128,
          target: { kind: 'local', scope: 'workspace', ref: attachmentRef },
        },
      });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message',
          messageId: 'windows-svg-artifact',
          content: [
            { type: 'text', text: 'SVG file is ready:' },
            {
              type: 'resource_link',
              uri: filePath,
              name: 'japan-kansai-4d3n-plan.svg',
              mimeType: 'image/svg+xml',
            },
            { type: 'image', mimeType: 'image/svg+xml', data: ONE_PIXEL_SVG_BASE64 },
          ],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('SVG file is ready:')).toBeVisible();
      await expect(page.getByText('MEDIA:C:')).toHaveCount(0);
      const svgCard = page.getByRole('button', { name: 'Preview japan-kansai-4d3n-plan.svg', exact: true });
      await expect(svgCard).toBeEnabled();
      await expect(svgCard).toContainText(filePath);
      await expect(page.getByTestId('acp-image-part').locator('img')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
