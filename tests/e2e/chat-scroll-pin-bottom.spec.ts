import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const RUN_ID = 'run-pin-e2e';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// Seed enough history that the scroll container overflows from the start.
const seededHistory = Array.from({ length: 40 }, (_, idx) => ({
  role: idx % 2 === 0 ? 'user' : 'assistant',
  content: `Chat history message ${idx + 1}`,
  timestamp: Date.now() + idx,
}));

// Build a streaming assistant text of `paragraphs` markdown paragraphs so each
// delta grows the rendered height deterministically.
function streamingText(paragraphs: number): string {
  return Array.from({ length: paragraphs }, (_, idx) => `Streaming paragraph ${idx + 1}.`).join('\n\n');
}

test.describe('ClawX chat scroll pin-to-bottom during runs', () => {
  test('keeps the scrollbar pinned to the bottom through oscillating tool-heavy streaming, and yields to manual scroll-up', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          // Null-arg fallbacks match regardless of the exact request payload.
          [stableStringify(['sessions.list', null])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', null])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: RUN_ID },
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
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
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
      await expect(page.getByText('Chat history message 40')).toBeVisible({ timeout: 30_000 });

      const scrollContainer = page.getByTestId('chat-scroll-container');

      // Emit a runtime streaming event for the active run.
      const emitDelta = async (message: Record<string, unknown>) => {
        await app.evaluate(({ BrowserWindow }, payload) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:notification', {
            method: 'agent',
            params: {
              runId: payload.runId,
              sessionKey: payload.sessionKey,
              data: { state: 'delta', message: payload.message },
            },
          });
        }, { runId: RUN_ID, sessionKey: SESSION_KEY, message });
      };

      // Assert the scrollbar is glued to the very bottom (within a small epsilon
      // that tolerates sub-pixel rounding).
      const expectPinnedToBottom = async () => {
        await expect
          .poll(
            async () =>
              scrollContainer.evaluate((el) => {
                const element = el as HTMLElement;
                return Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
              }),
            { timeout: 5_000 },
          )
          .toBeLessThanOrEqual(8);
      };

      // Start a run so pinning becomes active (sending === true).
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('do a multi-tool task');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Stop');

      // Growing text stream -> height keeps increasing; bar must stay at bottom.
      await emitDelta({ role: 'assistant', content: [{ type: 'text', text: streamingText(3) }] });
      await expectPinnedToBottom();

      await emitDelta({ role: 'assistant', content: [{ type: 'text', text: streamingText(8) }] });
      await expectPinnedToBottom();

      // Tool round -> layout oscillates (bubble/graph/tool-status churn); the
      // bar must still snap to the bottom rather than jitter upward.
      await emitDelta({
        role: 'assistant',
        content: [
          { type: 'text', text: streamingText(8) },
          { type: 'toolCall', id: 'tool-1', name: 'exec', arguments: { command: 'ls -la' } },
        ],
      });
      await expectPinnedToBottom();

      // Back to text growth after the tool round.
      await emitDelta({ role: 'assistant', content: [{ type: 'text', text: streamingText(14) }] });
      await expectPinnedToBottom();

      // Manual scroll-up while the run is live: pinning must yield to the user
      // and surface the "scroll to latest" affordance.
      await scrollContainer.evaluate((el) => {
        const element = el as HTMLElement;
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      const jumpButton = page.getByTestId('chat-scroll-to-latest');
      await expect(jumpButton).toBeVisible();

      // Further growth must NOT yank the user back down while they've escaped.
      await emitDelta({ role: 'assistant', content: [{ type: 'text', text: streamingText(20) }] });
      await expect(jumpButton).toBeVisible();
      const distanceFromBottom = await scrollContainer.evaluate((el) => {
        const element = el as HTMLElement;
        return Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
      });
      expect(distanceFromBottom).toBeGreaterThan(8);

      // Clicking the affordance returns to the bottom.
      await jumpButton.click();
      await expect(jumpButton).toBeHidden({ timeout: 10_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
