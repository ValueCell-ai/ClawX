// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('openclaw bundle config', () => {
  it('includes Electron runtime-only packages needed in packaged builds', async () => {
    const { EXTRA_BUNDLED_PACKAGES } = await import('../../scripts/openclaw-bundle-config.mjs');

    expect(EXTRA_BUNDLED_PACKAGES).toEqual(expect.arrayContaining([
      '@whiskeysockets/baileys',
      '@larksuiteoapi/node-sdk',
      '@grammyjs/runner',
      '@grammyjs/transformer-throttler',
      'grammy',
      '@buape/carbon',
      '@discordjs/voice',
      'discord-api-types',
      'opusscript',
      '@tencent-connect/qqbot-connector',
      'mpg123-decoder',
      'silk-wasm',
      '@agentclientprotocol/sdk',
      'playwright-core',
      'qrcode-terminal',
    ]));
  });
});
