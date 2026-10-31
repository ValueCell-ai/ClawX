import { completeSetup, expect, test } from './fixtures/electron';
import { navigateToSection } from './fixtures/navigation';

test('opens skills and assistants through independent sidebar entries', async ({ page }, testInfo) => {
  await completeSetup(page);
  const skillsEntry = page.getByTestId('sidebar-nav-skills');
  const agentsEntry = page.getByTestId('sidebar-nav-agents');
  await expect(page.getByTestId('sidebar-nav-capabilities')).toHaveCount(0);

  await skillsEntry.click();
  await expect(page).toHaveURL(/#\/skills$/);
  await expect(page.getByTestId('skills-page')).toBeVisible();
  await expect(skillsEntry).toHaveAttribute('aria-current', 'page');
  await expect(agentsEntry).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('skills-page').getByRole('heading', { level: 1, name: 'Skills', exact: true })).toBeVisible();
  await expect(page.getByText('Browse and manage AI capabilities', { exact: true })).toBeVisible();
  await expect(page.getByTestId('capabilities-tab-agents')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('skills-standalone.png'), animations: 'disabled' });

  await agentsEntry.click();
  await expect(page.getByTestId('agents-page')).toBeVisible();
  await expect(page).toHaveURL(/#\/agents$/);
  await expect(agentsEntry).toHaveAttribute('aria-current', 'page');
  await expect(skillsEntry).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('agents-page').getByRole('heading', { level: 1, name: 'Assistants', exact: true })).toBeVisible();
  await expect(page.getByTestId('capabilities-tab-skills')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('agents-standalone.png'), animations: 'disabled' });
  await skillsEntry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('skills-page')).toBeVisible();
  await expect(skillsEntry).toHaveAttribute('aria-current', 'page');

  await navigateToSection(page, 'general');
  await skillsEntry.click();
  await expect(page.getByTestId('skills-page')).toBeVisible();
});

test('exposes core capabilities in the sidebar and separates app preferences', async ({ page }, testInfo) => {
  await completeSetup(page);
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar.getByTestId('sidebar-nav-capabilities')).toHaveCount(0);
  for (const name of ['skills', 'agents', 'models', 'channels', 'computer-use']) {
    await expect(sidebar.getByTestId(`sidebar-nav-${name}`)).toBeVisible();
  }
  await expect(sidebar.getByTestId('sidebar-open-dev-console')).toHaveCount(0);

  await navigateToSection(page, 'agents');
  await expect(page.getByTestId('agents-page')).toBeVisible();
  await expect(page.getByTestId('sidebar-nav-agents')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('sidebar-nav-skills').click();
  await expect(page.getByTestId('skills-page')).toBeVisible();

  await navigateToSection(page, 'general');
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-dev-mode-switch')).toHaveCount(0);
  await expect(page.getByTestId('settings-nav-general')).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: testInfo.outputPath('settings-general.png'), animations: 'disabled' });

  for (const name of ['models', 'channels', 'computer-use']) await expect(page.getByTestId(`settings-nav-${name}`)).toHaveCount(0);
  await navigateToSection(page, 'models');
  await expect(page.getByTestId('providers-settings')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('sidebar-nav-models')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('settings-page')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('settings-models.png'), animations: 'disabled' });

  await navigateToSection(page, 'channels');
  await expect(page.getByRole('heading', { name: 'Messaging remote', exact: true })).toBeVisible();
  await expect(page.getByTestId('providers-settings')).toHaveCount(0);

  await navigateToSection(page, 'computer-use');
  await expect(page.getByText(/Computer operation is experimental/)).toBeVisible();
  await expect(page.getByTestId('computer-use-toggle')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open advanced settings' }).click();
  await expect(page.getByTestId('settings-dev-mode-switch')).toBeVisible();
  await expect(page.getByTestId('settings-open-dev-console')).toHaveCount(0);
  await page.getByTestId('settings-dev-mode-switch').click();
  await expect(page.getByTestId('settings-open-dev-console')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-advanced.png'), animations: 'disabled' });

  await page.getByTestId('settings-nav-about').click();
  await expect(page.getByTestId('settings-issue-report-open')).toBeVisible();
  await expect(page.getByTestId('settings-dev-mode-switch')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('settings-about.png'), animations: 'disabled' });
});

test('preserves legacy links, selected model tabs, browser history and developer focus', async ({ page }) => {
  await completeSetup(page);
  await navigateToSection(page, 'advanced');
  await page.getByTestId('settings-dev-mode-switch').click();
  await page.evaluate(() => { window.location.hash = '#/settings/models?tab=voice'; });
  await expect(page).toHaveURL(/#\/models\?tab=voice$/);
  await expect(page.getByTestId('asr-settings')).toBeVisible();

  await page.getByTestId('sidebar-nav-settings').click();
  await page.goBack();
  await expect(page.getByTestId('models-tab-voice')).toHaveAttribute('data-state', 'active');
  for (const [legacy, destination, testId] of [
    ['channels', 'channels', 'channels-page'],
    ['computer-use', 'computer-use', 'computer-use-page'],
  ]) {
    await page.evaluate((path) => { window.location.hash = `#/settings/${path}`; }, legacy);
    await expect(page).toHaveURL(new RegExp(`#/${destination}$`));
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  await page.evaluate(() => { window.location.hash = '#/settings?section=developer'; });
  await expect(page.getByTestId('settings-nav-advanced')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('settings-developer-section')).toBeFocused();
});

test('localizes categories and keeps settings usable in narrow windows', async ({ page }, testInfo) => {
  await completeSetup(page);
  await navigateToSection(page, 'general');
  for (const [language, heading] of [['中文', '消息遥控'], ['日本語', 'メッセージ遠隔操作'], ['Русский', 'Управление через мессенджеры']]) {
    await navigateToSection(page, 'general');
    await page.getByRole('button', { name: language, exact: true }).click();
    await expect(page.getByRole('button', { name: language, exact: true })).toHaveClass(/(?:^|\s)bg-black\/5(?:\s|$)/);
    await expect(page.getByTestId('sidebar-nav-channels')).toHaveText(heading);
    if (language === '中文') await page.screenshot({ path: testInfo.outputPath('settings-chinese-general.png'), animations: 'disabled' });
    await page.getByTestId('sidebar-nav-channels').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (language === '中文') await page.screenshot({ path: testInfo.outputPath('settings-chinese.png'), animations: 'disabled' });
    if (language === 'Русский') {
      await page.screenshot({ path: testInfo.outputPath('settings-russian.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 900, height: 650 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await navigateToSection(page, 'general');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByTestId('settings-nav-about').click();
  await expect(page.getByTestId('settings-issue-report-open')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const main = await page.getByTestId('main-content').boundingBox();
  const settings = await page.getByTestId('settings-page').boundingBox();
  expect(Math.abs(settings!.y + settings!.height - main!.y - main!.height)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('settings-chinese-narrow-dark.png'), animations: 'disabled' });
});
