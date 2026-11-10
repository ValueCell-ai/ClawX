// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('openclaw bundle config', () => {
  it('pins the OpenClaw 2026.10.10 runtime compatibility matrix', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.['@agentclientprotocol/sdk']).toBe('1.7.0');
    expect(packageJson.dependencies?.['@trycua/cua-driver']).toBe('0.37.0');
    expect(packageJson.devDependencies).toMatchObject({
      openclaw: '2026.10.10',
      electron: '41.10.7',
      '@openclaw/discord': '2026.10.10',
      '@tencent-connect/openclaw-qqbot': '2.0.3',
      '@tencent-connect/qqbot-connector': '1.2.0',
      '@openclaw/whatsapp': '2026.10.10',
      '@dingtalk-real-ai/dingtalk-connector': '0.8.26',
      'dingtalk-workspace-cli': '1.0.30',
      '@wecom/wecom-openclaw-plugin': '2026.10.30',
      '@openclaw/feishu': '2026.10.10',
      '@tencent-weixin/openclaw-weixin': '2.4.10',
    });

    const nodeDownloadScript = readFileSync(
      resolve(process.cwd(), 'scripts/download-bundled-node.mjs'),
      'utf8',
    );
    expect(nodeDownloadScript).toContain("const NODE_VERSION = '24.18.1'");
  });

  it('loads the process and filesystem native dependencies used by the bundled runtime', async () => {
    const host = realpathSync(resolve(process.cwd(), 'node_modules/openclaw'));
    const procEntry = require.resolve('@openclaw/proc-safe', { paths: [host] });
    const { getProcSafeNativeStatus } = await import(pathToFileURL(procEntry).href);
    expect(await getProcSafeNativeStatus({ probe: true })).toMatchObject({ loaded: true });
    const runtime = JSON.parse(readFileSync(resolve(host, 'package.json'), 'utf8'));
    expect(runtime.dependencies['@openclaw/fs-safe']).toBe('0.26.5');
    expect(runtime.dependencies['@openclaw/proc-safe']).toBe('0.4.2');
  });

  it('unpacks every native CUA SDK library required by Electron Main', () => {
    const builderConfig = readFileSync(resolve(process.cwd(), 'electron-builder.yml'), 'utf8');

    expect(builderConfig).toContain('- "**/node_modules/@trycua/**"');
    expect(builderConfig).toContain('- "**/node_modules/@ubjs/**"');
    expect(builderConfig).toContain('from: resources/cli/restore-openclaw-upgrade.mjs\n    to: cli/restore-openclaw-upgrade.mjs');
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
    expect(JSON.parse(raw.trim())).toEqual({ node: '24.18.0', sqlite: '3.53.1' });
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
    expect(readManifest('@openclaw/feishu')).toMatchObject({
      id: 'feishu',
      channels: ['feishu'],
    });
    expect(readManifest('@dingtalk-real-ai/dingtalk-connector')).toMatchObject({
      id: 'dingtalk-connector',
      channels: ['dingtalk-connector'],
    });
    expect(readManifest('@tencent-connect/openclaw-qqbot')).toMatchObject({
      id: 'openclaw-qqbot',
      channels: ['qqbot'],
    });
  });

  it('does not retain superseded channel plugin packages in the lockfile', () => {
    const lockfile = readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8');
    expect(lockfile).not.toContain("'@soimy/dingtalk@3.6.4':");
    expect(lockfile).not.toContain("'@soimy/dingtalk@3.6.6':");
    expect(lockfile).not.toContain("'@soimy/dingtalk@3.6.10':");
    expect(lockfile).toContain("'@dingtalk-real-ai/dingtalk-connector@0.8.26':");
    expect(lockfile).not.toContain("'@wecom/wecom-openclaw-plugin@2026.6.23':");
    expect(lockfile).not.toContain("'@wecom/wecom-openclaw-plugin@2026.8.17':");
    expect(lockfile).not.toContain("'@larksuite/openclaw-lark@2026.6.10':");
    expect(lockfile).not.toContain("'@larksuite/openclaw-lark@2026.7.9':");
    expect(lockfile).not.toContain("'@larksuite/openclaw-lark@2026.7.16':");
    expect(lockfile).toContain("'@openclaw/feishu@2026.10.10':");
    expect(lockfile).not.toContain("'@openclaw/qqbot@2026.7.1':");
    expect(lockfile).toContain("'@tencent-connect/openclaw-qqbot@2.0.3':");
    expect(lockfile).not.toContain("'@tencent-weixin/openclaw-weixin@2.4.6':");
    expect(lockfile).not.toContain("'@openclaw/ai@2026.7.1-2':");
    expect(lockfile).toContain("'@openclaw/ai@2026.10.10':");
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
