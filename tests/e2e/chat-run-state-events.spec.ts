import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const IMAGE_GENERATION_TASK_ID = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
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
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: MAIN_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: '/' }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, cwd: DEFAULT_WORKSPACE }])]: loadResult,
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

async function emitChatRuntimeEvent(
  app: ElectronApplication,
  payload: Record<string, unknown>,
) {
  await app.evaluate(
    async ({ app: _app }, runtimePayload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('chat:runtime-event', runtimePayload);
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

test.describe('ClawX chat run state events', () => {
  test('renders ACP tool run-state updates inline without the legacy execution graph', async ({ launchElectronApp }) => {
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
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
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
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
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
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
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

  test('projects OpenClaw image-generation structured media into ACP Chat previews', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/tmp/openclaw-generated-sky.png';

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 }, {
        [stableStringify(['media', 'thumbnails', {
          paths: [{ filePath: generatedPath, mimeType: 'image/png' }],
        }])]: {
          [generatedPath]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
        },
      });
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

      await emitChatRuntimeEvent(app, {
        type: 'tool.completed',
        sessionKey: `image_generate:${IMAGE_GENERATION_TASK_ID}`,
        runId: `image_generate:${IMAGE_GENERATION_TASK_ID}:ok`,
        toolCallId: 'message-tool',
        name: 'message',
        result: {
          details: {
            status: 'ok',
            deliveryStatus: 'sent',
            sourceReplySink: 'internal-ui',
            sourceReply: {
              mediaUrls: [generatedPath],
            },
          },
        },
      });

      await expect(page.getByText('Generated image is ready.')).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      const image = timeline.getByRole('img', { name: 'Image' });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
      await expect(page.getByTestId('image-preview-unavailable')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('replays OpenClaw image-generation previews from historical ACP tool output', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/tmp/openclaw-replayed-sky.png';

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 }, {
        [stableStringify(['media', 'thumbnails', {
          paths: [{ filePath: generatedPath, mimeType: 'image/png' }],
        }])]: {
          [generatedPath]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
        },
      });
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
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('replays OpenClaw image-generation previews from historical assistant MEDIA text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png';

    try {
      await installAcpChatMocks(app, { success: true, generation: 1 }, {
        [stableStringify(['media', 'thumbnails', {
          paths: [{ filePath: generatedPath, mimeType: 'image/png' }],
        }])]: {
          [generatedPath]: { preview: ONE_PIXEL_PNG_DATA_URL, fileSize: 67 },
        },
      });
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
            text: `图片生成完成！这是为你创建的蓝天白云风景图。\n\nMEDIA:${generatedPath}`,
          },
        },
      ], 1, true);

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Generated image is ready.')).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toBeVisible();
      const image = timeline.getByRole('img', { name: 'Image' });
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', ONE_PIXEL_PNG_DATA_URL);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not render plain MEDIA assistant text as an image', async ({ launchElectronApp }) => {
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
          messageId: 'plain-media-text',
          content: [{ type: 'text', text: `MEDIA: ${untrustedPath}` }],
        },
      ]);

      const timeline = page.getByTestId('acp-chat-timeline');
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`MEDIA: ${untrustedPath}`)).toBeVisible();
      await expect(timeline.getByTestId('acp-image-part')).toHaveCount(0);
      await expect(timeline.getByRole('img', { name: 'Image' })).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ACP SVG image content without legacy MEDIA marker leakage', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const filePath = String.raw`C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;

    try {
      await installAcpChatMocks(app);
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
      await expect(page.getByText('japan-kansai-4d3n-plan.svg')).toBeVisible();
      await expect(page.getByTestId('acp-image-part').locator('img')).toBeVisible();
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
