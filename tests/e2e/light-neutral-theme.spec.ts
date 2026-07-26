import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type ThemeSnapshot = {
  raw: Record<string, string>;
  computed: Record<string, string>;
};

async function readThemeSnapshot(page: import('@playwright/test').Page, mode: 'light' | 'dark'): Promise<ThemeSnapshot> {
  return await page.evaluate((themeMode) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(themeMode);

    const variables = ['--background', '--surface-modal', '--surface-input', '--surface-sidebar'];
    const rootStyle = window.getComputedStyle(root);

    const raw: Record<string, string> = {};
    const computed: Record<string, string> = {};

    for (const variable of variables) {
      raw[variable] = rootStyle.getPropertyValue(variable).trim();

      const probe = document.createElement('div');
      probe.style.color = `hsl(var(${variable}))`;
      document.body.appendChild(probe);
      computed[variable] = window.getComputedStyle(probe).color;
      probe.remove();
    }

    return { raw, computed };
  }, mode);
}

test.describe('ClawX light neutral theme tokens', () => {
  test('uses white and neutral gray surfaces in light mode without changing dark mode tokens', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const light = await readThemeSnapshot(page, 'light');
      expect(light.raw).toEqual({
        '--background': '0 0% 100%',
        '--surface-modal': '0 0% 100%',
        '--surface-input': '0 0% 96.5%',
        '--surface-sidebar': '0 0% 96%',
      });
      expect(light.computed).toEqual({
        '--background': 'rgb(255, 255, 255)',
        '--surface-modal': 'rgb(255, 255, 255)',
        '--surface-input': 'rgb(246, 246, 246)',
        '--surface-sidebar': 'rgb(245, 245, 245)',
      });

      const dark = await readThemeSnapshot(page, 'dark');
      expect(dark.raw).toEqual({
        '--background': '240 4% 11%',
        '--surface-modal': '240 3% 14%',
        '--surface-input': '240 3% 18%',
        '--surface-sidebar': '240 4% 11%',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
