import { completeSetup, expect, test } from './fixtures/electron';

const TEST_PROVIDER_ID = 'moonshot-global-e2e';
const TEST_PROVIDER_LABEL = 'Moonshot Global E2E';

async function seedTestProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('provider:save', {
      id: providerId,
      name: providerLabel,
      type: 'moonshot-global',
      baseUrl: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.5',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }, { providerId: TEST_PROVIDER_ID, providerLabel: TEST_PROVIDER_LABEL });
}

test.describe('Moonshot Global provider lifecycle', () => {
  test('shows a saved moonshot-global provider with correct defaults and removes it cleanly', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
  });
});
