import type { Locator } from '@playwright/test';
import { expect } from './electron';

export async function expectMenuSelection(option: Locator): Promise<string> {
  await expect(option).toHaveAttribute('aria-current', 'true');
  const dot = option.locator('[data-slot="menu-selection-indicator"]');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS('width', '6px');
  await expect(dot).toHaveCSS('height', '6px');
  await expect(dot).toHaveCSS('border-radius', '9999px');
  // Wait for the selection's color transition after changing an option.
  await expect(option).toHaveCSS('background-color', /^rgba\(\d+, \d+, \d+, 0\.1\)$/);
  const background = await option.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  await option.hover();
  await expect(option).toHaveCSS('background-color', background);
  return background;
}
