import type { Locator } from '@playwright/test';

export async function selectValue(trigger: Locator, value: string) {
  await trigger.click();
  await trigger.page().locator('[data-slot="select-content"][data-state="open"]')
    .locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}
