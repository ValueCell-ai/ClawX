import type { Page } from '@playwright/test';

/** Navigate through visible controls so moved configuration stays covered. */
export async function navigateToSection(page: Page, section: string): Promise<void> {
  if (section === 'agents' || section === 'skills') {
    await page.getByTestId('sidebar-nav-capabilities').click();
    await page.getByTestId(`capabilities-tab-${section}`).click();
    return;
  }
  if (['models', 'channels', 'computer-use', 'general', 'advanced', 'about', 'settings'].includes(section)) {
    await page.getByTestId('sidebar-nav-settings').click();
    if (section !== 'settings') await page.getByTestId(`settings-nav-${section}`).click();
    return;
  }
  await page.getByTestId(`sidebar-nav-${section}`).click();
}
