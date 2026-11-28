import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installAttachmentHostFixture, test } from './fixtures/electron';

// Install after opening a fresh chat so its first create and first prompt can fail
// independently. Let the ordinary ACP fixture handle successful retries and replay.
async function failFirstLoadAndPrompt(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { id?: string; module?: string; action?: string; payload?: { message?: string } };
    type Handler = (event: unknown, request: Request) => Promise<unknown>;
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
      ._invokeHandlers.get('host:invoke');
    if (!original) throw new Error('Missing host invocation fixture');

    const dispatches: string[] = [];
    (globalThis as typeof globalThis & { __failedPromptDispatches: string[] }).__failedPromptDispatches = dispatches;
    let firstLoad = true;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module === 'chat' && request.action === 'loadAcpSession' && firstLoad) {
        firstLoad = false;
        return { id: request.id, ok: true, data: { success: false, error: 'Session load unavailable' } };
      }
      if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
        dispatches.push(request.payload?.message ?? '');
        if (dispatches.length === 1) {
          return { id: request.id, ok: true, data: { success: false, error: 'Prompt delivery failed' } };
        }
      }
      return original(event, request);
    });
  });
}

function dispatchedPrompts(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (
    (globalThis as typeof globalThis & { __failedPromptDispatches: string[] }).__failedPromptDispatches
  ));
}

test('retains a failed prompt through session creation, navigation and explicit retries', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const prompt = '请核对合同中所有的交付日期。\n\nList each deadline and the team responsible.';
  const nextDraft = 'A separate, unfinished follow-up';
  try {
    await installAttachmentHostFixture(app, {
      sessions: [{ key: 'agent:main:main', title: 'Existing conversation' }],
      inlineSessionReplay: true,
    });
    const page = await getStableWindow(app);
    await page.reload();
    const existingSession = page.getByTestId('sidebar-session-agent:main:main');
    await expect(existingSession).toBeVisible();
    await page.getByTestId('sidebar-new-chat').click();
    const input = page.getByTestId('chat-composer-input');
    await input.fill(prompt);
    await failFirstLoadAndPrompt(app);
    await page.getByTestId('chat-composer-send').click();

    const failed = page.getByTestId('chat-failed-prompt');
    await expect(failed).toHaveAttribute('role', 'alert');
    await expect(failed).toContainText('Session load unavailable');
    await expect(failed).toContainText(prompt);
    expect(await dispatchedPrompts(app)).toEqual([]);

    const localSession = page.getByTestId(/^sidebar-session-agent:main:session-/);
    await expect(localSession).toContainText('请核对合同中所有的交付日期。');
    await existingSession.click();
    await expect(failed).toHaveCount(0);
    await expect(input).toHaveText('');
    await input.fill('Draft for the existing conversation');
    await localSession.click();
    await expect(failed).toContainText(prompt);
    await expect(input).toHaveText('');
    expect(await dispatchedPrompts(app)).toEqual([]);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.goBack();
    await expect(failed).toContainText(prompt);
    expect(await dispatchedPrompts(app)).toEqual([]);

    await input.fill(nextDraft);
    await failed.getByTestId('chat-retry-prompt').click();
    await expect.poll(() => dispatchedPrompts(app)).toEqual([prompt]);
    await expect(failed).toContainText('Prompt delivery failed');
    await expect(failed).toContainText(prompt);
    await expect(input).toHaveText(nextDraft);

    await failed.getByTestId('chat-retry-prompt').click();
    await expect(page.getByTestId('acp-user-message')).toHaveText(prompt);
    await expect(failed).toHaveCount(0);
    await expect(input).toHaveText(nextDraft);
    expect(await dispatchedPrompts(app)).toEqual([prompt, prompt]);
  } finally {
    await closeElectronApp(app);
  }
});
