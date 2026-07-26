// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('openclaw bundle config', () => {
  it('pins the OpenClaw 2026.7.1 runtime compatibility matrix', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.['@agentclientprotocol/sdk']).toBe('1.1.0');
    expect(packageJson.devDependencies).toMatchObject({
      openclaw: '2026.7.1',
      electron: '40.10.6',
      '@openclaw/discord': '2026.7.1',
      '@openclaw/qqbot': '2026.7.1',
      '@openclaw/whatsapp': '2026.7.1',
      '@soimy/dingtalk': '3.6.6',
      '@wecom/wecom-openclaw-plugin': '2026.7.2',
      '@larksuite/openclaw-lark': '2026.7.9',
    });

    const nodeDownloadScript = readFileSync(
      resolve(process.cwd(), 'scripts/download-bundled-node.mjs'),
      'utf8',
    );
    expect(nodeDownloadScript).toContain("const NODE_VERSION = '22.22.3'");
  });

  it('uses an Electron runtime with OpenClaw-compatible Node and SQLite versions', () => {
    const electronPath = require('electron') as string;
    const raw = execFileSync(
      electronPath,
      ['-p', 'JSON.stringify({node:process.versions.node,sqlite:process.versions.sqlite})'],
      {
        encoding: 'utf8',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    expect(JSON.parse(raw.trim())).toEqual({ node: '24.15.0', sqlite: '3.51.3' });
  });

  it('keeps upstream WeCom and Open Lark manifest identities unchanged across the version bump', () => {
    const readManifest = (packagePath: string) => JSON.parse(readFileSync(
      resolve(process.cwd(), 'node_modules', ...packagePath.split('/'), 'openclaw.plugin.json'),
      'utf8',
    )) as { id?: string; channels?: string[] };

    expect(readManifest('@wecom/wecom-openclaw-plugin')).toMatchObject({
      id: 'wecom-openclaw-plugin',
      channels: ['wecom'],
    });
    expect(readManifest('@larksuite/openclaw-lark')).toMatchObject({
      id: 'openclaw-lark',
      channels: ['feishu'],
    });
  });

  it('does not retain superseded channel plugin packages in the lockfile', () => {
    const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8');
    expect(lockfile).not.toContain("'@soimy/dingtalk@3.6.4':");
    expect(lockfile).not.toContain("'@wecom/wecom-openclaw-plugin@2026.6.23':");
    expect(lockfile).not.toContain("'@larksuite/openclaw-lark@2026.6.10':");
    expect(lockfile).toContain("'@openclaw/ai@2026.7.1':");
  });

  it('includes Electron runtime-only packages needed in packaged builds', async () => {
    const { ELECTRON_MAIN_RUNTIME_PACKAGES, EXTRA_BUNDLED_PACKAGES } = await import('../../scripts/openclaw-bundle-config.mjs');

    expect(ELECTRON_MAIN_RUNTIME_PACKAGES).toEqual([
      '@whiskeysockets/baileys',
      'qrcode-terminal',
    ]);
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
