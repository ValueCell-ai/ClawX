// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('openclaw bundle config', () => {
  it('includes Electron runtime-only packages needed in packaged builds', async () => {
    const { EXTRA_BUNDLED_PACKAGES } = await import('../../scripts/openclaw-bundle-config.mjs');

    expect(EXTRA_BUNDLED_PACKAGES).toContain('@whiskeysockets/baileys');
    expect(EXTRA_BUNDLED_PACKAGES).toContain('@larksuiteoapi/node-sdk');
    expect(EXTRA_BUNDLED_PACKAGES).toContain('qrcode-terminal');
  });
});
