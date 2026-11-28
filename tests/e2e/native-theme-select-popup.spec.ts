import { navigateToSection } from './fixtures/navigation';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function expectAsrLanguagePopupThemed(page: import('@playwright/test').Page): Promise<void> {
  await navigateToSection(page, 'models');
  await page.getByTestId('models-tab-voice').click();
  await page.getByTestId('asr-configure').click();
  const dialog = page.getByTestId('asr-config-dialog');
  const groq = dialog.getByTestId('asr-preset-groq');
  await groq.click();
  const expectedFilter = await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'invert(1)' : 'none');
  await expect(groq.locator('img')).toHaveCSS('filter', expectedFilter);
  await expect(dialog.getByTestId('asr-config-details').locator('img')).toHaveCSS('filter', expectedFilter);
  await dialog.getByTestId('asr-preset-openai').click();
  await dialog.getByTestId('asr-language-input').click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const surface = await list.evaluate(element => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'hsl(var(--surface-modal))';
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  expect(surface.actual).toBe(surface.expected);
  expect(surface.actual).not.toBe('rgba(0, 0, 0, 0)');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('asr-config-dialog-close').click();
}

test.describe('model select theming', () => {
  test('speech-to-text language options use the opaque themed background in both schemes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await navigateToSection(page, 'advanced');
      const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
      if (await devModeSwitch.getAttribute('data-state') !== 'checked') await devModeSwitch.click();
      await expect(devModeSwitch).toHaveAttribute('data-state', 'checked');

      for (const theme of ['Dark', 'Light']) {
        await navigateToSection(page, 'general');
        await page.getByRole('button', { name: theme, exact: true }).click();
        await expect.poll(() => page.evaluate(name => document.documentElement.classList.contains(name), theme.toLowerCase())).toBe(true);
        await expectAsrLanguagePopupThemed(page);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('follow-system mode reacts to live OS scheme changes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      const rootThemeClass = () => page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');

      // Follow-system must track the OS scheme live, not freeze at the
      // scheme that was current when the setting was chosen.
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(rootThemeClass).toBe('dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect.poll(rootThemeClass).toBe('light');

      // Explicit selections ignore the OS scheme.
      await navigateToSection(page, 'general');
      await page.getByRole('button', { name: 'Dark', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(rootThemeClass).toBe('dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect.poll(rootThemeClass).toBe('dark');

      // Switching back to follow-system picks the OS scheme up again.
      await page.getByRole('button', { name: 'System', exact: true }).click();
      await expect.poll(rootThemeClass).toBe('light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(rootThemeClass).toBe('dark');
    } finally {
      await closeElectronApp(app);
    }
  });
});
