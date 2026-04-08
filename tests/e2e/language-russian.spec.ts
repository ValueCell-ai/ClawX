import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Russian language localization', () => {
  test('shows Russian language option in setup wizard', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    
    try {
      const page = await getStableWindow(app);
      
      // Should see the setup wizard
      await expect(page.getByTestId('setup-page')).toBeVisible();
      
      // Should have Russian language button visible
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await expect(russianButton).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('can switch to Russian language in setup wizard', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    
    try {
      const page = await getStableWindow(app);
      
      await expect(page.getByTestId('setup-page')).toBeVisible();
      
      // Click Russian language button
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await russianButton.click();
      
      // Verify UI renders in Russian by checking for Russian-only text
      // "Добро пожаловать" is unique to Russian and won't appear in English
      await expect(page.locator('h2')).toContainText('Добро пожаловать');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('Russian language persists after skipping setup', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    
    try {
      const page = await getStableWindow(app);
      
      await expect(page.getByTestId('setup-page')).toBeVisible();
      
      // Switch to Russian
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await russianButton.click();
      
      // Skip setup
      await page.getByTestId('setup-skip-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      
      // Navigate to Settings to verify language persistence
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      
      // Verify sidebar shows Russian text (not English)
      // "Настройки" is Russian-only, English is "Settings"
      await expect(page.getByTestId('sidebar-nav-settings')).toContainText('Настройки');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('can switch to Russian in Settings page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    
    try {
      const page = await getStableWindow(app);
      
      await expect(page.getByTestId('main-layout')).toBeVisible();
      
      // Navigate to Settings (in English by default after skipSetup)
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      
      // Click Russian language button
      const russianButton = page.locator('button', { hasText: 'Русский' });
      await russianButton.click();
      
      // Verify sidebar switched to Russian
      // "Настройки" is Russian-only, English is "Settings"
      await expect(page.getByTestId('sidebar-nav-settings')).toContainText('Настройки');
    } finally {
      await closeElectronApp(app);
    }
  });
});
