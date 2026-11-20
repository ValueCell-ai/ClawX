import type { Locator } from '@playwright/test';
import { expect } from './electron';

/** Guard the rendered focus treatment, including page-level field overrides. */
export async function expectQuietFieldFocus(field: Locator) {
  await expect(field).toHaveCSS('--tw-ring-offset-width', '0px');
  await expect.poll(() => field.evaluate(element => {
    const style = getComputedStyle(element);
    const colors = [style.borderTopColor, ...Array.from(style.boxShadow.matchAll(/rgba?\([^)]+\)/g), match => match[0])];
    const neutral = colors.every(color => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      return channels?.length === 3 && Math.max(...channels) - Math.min(...channels) < 30;
    });
    return neutral && style.boxShadow.includes('0px 0px 0px 1px');
  })).toBe(true);
}
