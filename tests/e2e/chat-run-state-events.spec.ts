import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat run state events', () => {
  test('keeps stop control active across non-terminal runtime events and clears it on run.ended', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-e2e' },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/chat/sessions', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: {
                  sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
                },
              },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: { messages: [] },
              },
            },
          },
          [stableStringify(['/api/chat/send', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: { runId: 'run-e2e' },
              },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
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

      const sendButton = page.getByTestId('chat-composer-send');
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('run long task');
      await sendButton.click();
      await expect(sendButton).toHaveAttribute('title', /Stop|停止/);

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId: 'run-e2e',
            toolCallId: 'call-1',
            name: 'read',
            args: { filePath: '/tmp/demo.md' },
          });
        }
      });

      await expect(page.getByTestId('chat-execution-graph')).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.completed',
            runId: 'run-e2e',
            toolCallId: 'call-1',
            name: 'read',
            result: { summary: 'done' },
            isError: false,
          });
        }
      });

      await expect(sendButton).toHaveAttribute('title', /Stop|停止/);

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'run-e2e',
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      });

      await expect(sendButton).toHaveAttribute('title', /Send|发送/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows clear image preview states for generated media while hydration retries', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const gatewayUrl = '/api/chat/media/outgoing/agent%3Amain%3Aimage-preview/image-1/full';
    const history = [
      {
        role: 'assistant',
        id: 'generated-image',
        timestamp: Date.now() / 1000,
        content: [{
          type: 'image',
          url: gatewayUrl,
          mimeType: 'image/png',
          alt: 'generated.png',
        }],
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
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
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/files/thumbnails', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { [gatewayUrl]: { preview: null, fileSize: 0 } },
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

      await expect(page.getByTestId('image-preview-unavailable')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('surfaces images delivered through message-tool-only history records', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const imagePath = '/tmp/puppy.png';
    const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const history = [
      {
        role: 'user',
        id: 'request',
        timestamp: Date.now() / 1000 - 10,
        content: [{ type: 'text', text: 'Generate a puppy image' }],
      },
      {
        role: 'assistant',
        id: 'send-image',
        timestamp: Date.now() / 1000 - 2,
        content: [
          { type: 'text', text: "I'll deliver the puppy image via the message tool." },
          {
            type: 'toolCall',
            id: 'message-call',
            name: 'message',
            arguments: {
              action: 'send',
              message: 'Puppy ready',
              attachments: [{ type: 'image', path: imagePath, name: 'puppy.png' }],
            },
          },
        ],
      },
      {
        role: 'toolResult',
        id: 'message-result',
        toolCallId: 'message-call',
        toolName: 'message',
        timestamp: Date.now() / 1000 - 1,
        content: [{ type: 'text', text: '{ "status": "ok", "deliveryStatus": "sent" }' }],
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplyDeliveryMode: 'message_tool_only',
          sourceReplySink: 'internal-ui',
          sourceReply: {
            text: 'Puppy ready',
            mediaUrl: imagePath,
            mediaUrls: [imagePath],
          },
          mediaUrl: imagePath,
          mediaUrls: [imagePath],
        },
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
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
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/files/thumbnails', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { [imagePath]: { preview, fileSize: 68 } },
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

      await expect(page.getByText('Puppy ready')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("I'll deliver the puppy image via the message tool.")).toHaveCount(0);
      await expect(page.locator('img[alt="puppy.png"]')).toHaveCount(1);
      await expect(page.locator('img[alt="puppy.png"]')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hydrates Windows MEDIA SVG artifacts without leaking the marker text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const filePath = String.raw`C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`;
    const svgPreview = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>').toString('base64')}`;
    const history = [
      {
        role: 'assistant',
        id: 'windows-svg-artifact',
        timestamp: Date.now() / 1000,
        content: String.raw`SVG file is ready:

MEDIA:C:\Users\Administrator\.openclaw\workspace\japan-kansai-4d3n-plan.svg`,
      },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
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
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
          [stableStringify(['/api/files/thumbnails', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { [filePath]: { preview: svgPreview, fileSize: 73 } },
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

      await expect(page.getByText('SVG file is ready:')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('MEDIA:C:')).toHaveCount(0);
      await expect(page.locator('img[alt="japan-kansai-4d3n-plan.svg"]')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
