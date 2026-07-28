import { expect, type Page } from '@playwright/test';

export async function expandAcpToolCallsGroup(page: Page) {
  const group = page.getByTestId('acp-tool-calls-group');
  await expect(group).toBeVisible({ timeout: 30_000 });

  if (await group.getAttribute('data-collapsed') !== 'false') {
    await group.click();
  }

  await expect(group).toHaveAttribute('data-collapsed', 'false', { timeout: 5_000 });
}

export async function expectVisibleToolCallCards(page: Page, count: number) {
  const cards = page.getByTestId('acp-tool-call-card');

  if (count <= 1) {
    await expect(cards).toHaveCount(count, { timeout: 30_000 });
    return;
  }

  await expandAcpToolCallsGroup(page);
  await expect(cards).toHaveCount(count, { timeout: 30_000 });
}
