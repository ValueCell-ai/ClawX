// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      'acpx',
      'playwright-core',
      'qrcode-terminal',
    ]));
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.acpx ?? packageJson.dependencies?.acpx).toBe('0.5.3');
  });
});
