import type { Locator } from '@playwright/test';
import { expect } from './electron';

export async function settleFloatingSurface(surface: Locator) {
  await expect.poll(() => surface.evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
}
