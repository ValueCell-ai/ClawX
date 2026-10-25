import type { Locator, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { settleFloatingSurface } from './fixtures/floating-ui';
import { navigateToSection } from './fixtures/navigation';

async function watchExit(content: Locator) {
  await content.evaluate(element => {
    const state = globalThis as unknown as { floatingExit?: { mounted: boolean; animation: string; duration: string; pointerEvents: string } };
    delete state.floatingExit;
    const observer = new MutationObserver(() => {
      if (element.getAttribute('data-state') !== 'closed') return;
      const style = getComputedStyle(element);
      state.floatingExit = { mounted: element.isConnected, animation: style.animationName, duration: style.animationDuration, pointerEvents: style.pointerEvents };
      observer.disconnect();
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-state'] });
  });
}

async function expectExit(page: Page, content: Locator, reduced: boolean) {
  if (!reduced) {
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { floatingExit?: unknown }).floatingExit)).toEqual({
      mounted: true, animation: 'clawx-floating-out', duration: '0.09s', pointerEvents: 'none',
    });
  }
  await expect(content).toHaveCount(0);
}

for (const reduced of [false, true]) {
  test(`Radix dropdown motion, dismissal and selection with reduced motion ${reduced}`, async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpc: { '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'Control task', workspacePath: '/tmp/radix-workspace', updatedAt: Date.now() }] } } },
        hostApi: {
          '["/api/settings","GET"]': { language: 'en', setupComplete: true, chatWorkspacePath: '/tmp/radix-workspace', theme: reduced ? 'dark' : 'light' },
          '["/api/agents","GET"]': { success: true, defaultAgentId: 'main', defaultModelRef: 'custom-alpha123/model-a', agents: [
            { id: 'main', name: 'Main', modelDisplay: 'model-a', modelRef: 'custom-alpha123/model-a', workspace: '/tmp/radix-workspace', mainSessionKey: 'agent:main:main' },
            { id: 'coder', name: 'Coder', modelDisplay: 'model-b', modelRef: 'custom-beta1234/model-b', workspace: '/tmp/radix-coder', mainSessionKey: 'agent:coder:main' },
          ] },
          '["/api/cron/jobs","GET"]': [],
          '["/api/channels/accounts","GET"]': { success: true, channels: [] },
          '["/api/skills/quick-access","POST"]': { success: true, skills: [{ name: 'pdf', description: 'PDF tools', source: 'workspace', sourceLabel: 'Workspace', baseDir: '/tmp/pdf', manifestPath: '/tmp/pdf/SKILL.md' }] },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        type Request = { id: string; module: string; action: string };
        const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => unknown> })._invokeHandlers.get('host:invoke')!;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', (event: unknown, request: Request) => {
          const respond = (data: unknown) => ({ id: request.id, ok: true, data });
          if (request.module === 'chat' && request.action === 'loadAcpSession') return respond({ success: true, generation: 1 });
          if (request.module === 'providers' && request.action === 'accounts') return respond(['alpha123', 'beta1234'].map((id, index) => ({ id, vendorId: 'custom', label: id, authMode: 'api_key', enabled: true, model: index ? 'model-b' : 'model-a', updatedAt: '2026-10-25' })));
          if (request.module === 'providers' && request.action === 'accountKeyInfo') return respond(['alpha123', 'beta1234'].map(accountId => ({ accountId, hasKey: true })));
          if (request.module === 'providers' && request.action === 'vendors') return respond([]);
          if (request.module === 'providers' && request.action === 'getDefaultAccount') return respond({ accountId: 'alpha123' });
          return original(event, request);
        });
      });
      const page = await getStableWindow(app);
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await page.reload();
      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      for (const [triggerId, contentId] of [
        ['chat-composer-agent', 'chat-agent-picker-menu'],
        ['chat-model-picker-button', 'chat-model-picker-menu'],
        ['chat-composer-skill', 'chat-skill-picker-menu'],
        ['chat-workspace-selector', 'chat-workspace-menu'],
      ]) {
        await page.getByTestId(triggerId).click();
        const content = page.getByTestId(contentId);
        await expect(content).toHaveAttribute('data-state', 'open');
        await expect(content).toHaveCSS('animation-name', reduced ? 'none' : 'clawx-floating-in');
        if (!reduced) await expect(content).toHaveCSS('animation-duration', '0.14s');
        await settleFloatingSurface(content);
        if (contentId === 'chat-skill-picker-menu') {
          await expect(content.locator('input')).toBeFocused();
          await content.locator('input').fill('pdf');
          await expect(content.getByTestId('chat-composer-skill-option-pdf')).toBeVisible();
        } else {
          expect(await content.evaluate(element => element.contains(document.activeElement))).toBe(true);
        }
        await watchExit(content);
        await page.keyboard.press('Escape');
        await expectExit(page, content, reduced);
        await expect(page.getByTestId('chat-composer-input')).toBeFocused();
      }
      // Reopening before an old focus restoration callback must not dismiss the new layer.
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-composer-skill').click();
      await expect(page.getByTestId('chat-skill-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-menu')).toHaveCount(0);
      await page.getByRole('heading').first().click();
      await expect(page.getByTestId('chat-skill-picker-menu')).toHaveCount(0);

      await navigateToSection(page, 'cron');
      await page.getByTestId('cron-new-task-button').click();
      const select = page.getByTestId('cron-recurrence-select');
      await select.click();
      const listbox = page.locator('[data-slot="select-content"]');
      await expect(listbox).toHaveAttribute('role', 'listbox');
      await expect(listbox).toHaveCSS('animation-name', reduced ? 'none' : 'clawx-floating-in');
      await settleFloatingSurface(listbox);
      await watchExit(listbox);
      await listbox.locator('[data-value="weekly"]').click();
      await expect(select).toHaveAttribute('value', 'weekly');
      await expectExit(page, listbox, reduced);
      await expect(select).toBeFocused();
      await expect(page.getByTestId('cron-weekday-select')).toBeVisible();
      await page.locator('#cron-weekly-time').click();
      const timePicker = page.getByTestId('cron-weekly-time-menu');
      await expect(timePicker).toHaveCSS('animation-name', reduced ? 'none' : 'clawx-floating-in');
      await page.keyboard.press('Escape');
      await expect(timePicker).toHaveCount(0);
      await expect(page.getByTestId('cron-task-dialog')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
}
