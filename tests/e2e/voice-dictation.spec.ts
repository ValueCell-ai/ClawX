import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const TRANSCRIBED_TEXT = 'voice dictation result';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function stubMicrophoneCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...navigator.mediaDevices,
        getUserMedia: async () => {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          return destination.stream;
        },
      },
    });
  });
}

// The transcribe payload embeds recording bytes, so its hostApi mock key is
// not stable; intercept asr.transcribe dynamically and fall through to the
// previously installed host:invoke handler for everything else.
async function installAsrTranscribeMock(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(async ({ app: _app }, transcribed) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type HostHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers;
    const previousHostInvoke = handlers?.get('host:invoke');

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (request.module === 'asr' && request.action === 'transcribe') {
        return {
          id: typeof request.id === 'string' ? request.id : undefined,
          ok: true,
          data: { text: transcribed },
        };
      }
      return previousHostInvoke?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, text);
}

async function reloadRenderer(page: Page): Promise<void> {
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
}

test.describe('ClawX voice dictation', () => {
  test('inserts transcribed text at cursor after recording', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        hostApi: {
          [stableStringify(['asr', 'getConfig', null])]: {
            configured: true,
            config: {
              preset: 'siliconflow',
              baseUrl: 'https://api.siliconflow.cn/v1',
              model: 'Qwen/Qwen3-ASR-1.7B',
            },
            hasApiKey: true,
          },
        },
      });
      await installAsrTranscribeMock(app, TRANSCRIBED_TEXT);

      const page = await getStableWindow(app);
      await stubMicrophoneCapture(page);
      await reloadRenderer(page);

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill('hello ');

      const voiceButton = page.getByTestId('chat-composer-voice');
      await expect(voiceButton).toHaveAttribute('title', 'Voice input');
      await voiceButton.click();
      await expect(voiceButton).toHaveAttribute('title', 'Stop recording');
      await expect(voiceButton).toContainText('0:01');

      await voiceButton.click();
      await expect(composer).toHaveValue(`hello ${TRANSCRIBED_TEXT}`);
      await expect(voiceButton).toHaveAttribute('title', 'Voice input');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('guides to the models voice tab when asr is unconfigured', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        hostApi: {
          [stableStringify(['asr', 'getConfig', null])]: {
            configured: false,
            config: null,
            hasApiKey: false,
          },
        },
      });

      const page = await getStableWindow(app);
      await reloadRenderer(page);

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-voice').click();
      await expect(page.locator('[data-sonner-toast]')).toContainText('not configured');
      await expect(page).toHaveURL(/\/models/);
      await expect(page).toHaveURL(/tab=voice/);
      await expect(page.getByTestId('asr-settings')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
