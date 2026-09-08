import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

/**
 * Chromium paints native <select> dropdown popups with the select's own
 * computed background-color and text color. If the select is transparent
 * (e.g. shared `bg-transparent` input classes), the Windows popup shows a
 * white page background behind light option text in dark mode — unreadable.
 * These specs lock in the fix: every themed select must resolve the opaque
 * `--background` token in both schemes.
 */
async function expectSelectThemed(page: import('@playwright/test').Page, testId: string): Promise<void> {
  await expect
    .poll(async () => page.evaluate((id) => {
      const select = document.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`);
      if (!select) return null;
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'hsl(var(--background))';
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const actual = getComputedStyle(select).backgroundColor;
      return { actual, expected };
    }, testId))
    .toEqual({ actual: expect.not.stringContaining('rgba'), expected: expect.any(String) });

  const colors = await page.evaluate((id) => {
    const select = document.querySelector<HTMLSelectElement>(`[data-testid="${id}"]`);
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'hsl(var(--background))';
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { actual: getComputedStyle(select).backgroundColor, expected };
  }, testId);
  expect(colors.actual).toBe(colors.expected);
}

test.describe('native select theming', () => {
  test('speech-to-text provider select uses the opaque themed background in both schemes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Switch the app to dark mode via Settings > Appearance.
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByRole('button', { name: 'Dark', exact: true }).click();
      await expect(page.evaluate(() => document.documentElement.classList.contains('dark'))).resolves.toBe(true);

      // The Models > Voice (speech-to-text) provider select must resolve the
      // dark opaque background so its popup options stay readable.
      await page.getByTestId('sidebar-nav-models').click();
      await page.getByTestId('models-tab-voice').click();
      await expect(page.getByTestId('asr-preset-select')).toBeVisible();
      await expectSelectThemed(page, 'asr-preset-select');

      // Switching back to light keeps the select on the (now white) token.
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByRole('button', { name: 'Light', exact: true }).click();
      await expect(page.evaluate(() => document.documentElement.classList.contains('light'))).resolves.toBe(true);

      await page.getByTestId('sidebar-nav-models').click();
      await page.getByTestId('models-tab-voice').click();
      await expect(page.getByTestId('asr-preset-select')).toBeVisible();
      await expectSelectThemed(page, 'asr-preset-select');
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
