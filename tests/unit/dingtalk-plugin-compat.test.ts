import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DINGTALK_OFFICIAL_NPM,
  DINGTALK_OFFICIAL_PLUGIN_ID,
  DINGTALK_PLUGIN_ID,
  ensureDingTalkPluginActivation,
  migrateDingTalkChannelSection,
  migrateDingTalkPluginRegistrations,
  patchDingTalkChannelIdsInJs,
  remapDingTalkOfficialManifest,
  remapDingTalkOfficialPackageJson,
  sanitizeDingTalkChannelConfig,
} from '@electron/utils/dingtalk-plugin-compat';

describe('sanitizeDingTalkChannelConfig', () => {
  it('maps soimy card messageType to official groupReplyMode and keeps credentials', () => {
    const config = sanitizeDingTalkChannelConfig({
      enabled: true,
      clientId: 'ding-app',
      clientSecret: 'secret',
      defaultAccount: 'default',
      messageType: 'card',
      cardStreamingMode: 'realtime',
      learningEnabled: true,
      robotCode: 'old-robot',
      corpId: 'corp',
      agentId: 'agent',
    });

    expect(config).toEqual({
      enabled: true,
      clientId: 'ding-app',
      clientSecret: 'secret',
      defaultAccount: 'default',
      groupReplyMode: 'aicard',
    });
  });

  it('maps markdown messageType and sanitizes nested accounts', () => {
    const config = sanitizeDingTalkChannelConfig({
      messageType: 'markdown',
      accounts: {
        default: {
          clientId: 'nested',
          clientSecret: 'nested-secret',
          messageType: 'card',
          journalTTLDays: 7,
        },
      },
    });

    expect(config.groupReplyMode).toBe('markdown');
    expect(config.accounts).toEqual({
      default: {
        clientId: 'nested',
        clientSecret: 'nested-secret',
        groupReplyMode: 'aicard',
      },
    });
  });
});

describe('migrateDingTalkChannelSection', () => {
  it('copies official-only config onto channels.dingtalk', () => {
    const config = {
      channels: {
        'dingtalk-connector': {
          enabled: true,
          clientId: 'from-official',
        },
      },
    };

    expect(migrateDingTalkChannelSection(config)).toBe(true);
    expect(config.channels.dingtalk).toEqual({
      enabled: true,
      clientId: 'from-official',
    });
    expect(config.channels['dingtalk-connector']).toBeUndefined();
  });

  it('prefers channels.dingtalk when both keys exist', () => {
    const config = {
      channels: {
        dingtalk: {
          enabled: true,
          clientId: 'clawx',
          messageType: 'card',
        },
        'dingtalk-connector': {
          enabled: true,
          clientId: 'official',
        },
      },
    };

    expect(migrateDingTalkChannelSection(config)).toBe(true);
    expect(config.channels.dingtalk).toEqual({
      enabled: true,
      clientId: 'clawx',
      groupReplyMode: 'aicard',
    });
    expect(config.channels['dingtalk-connector']).toBeUndefined();
  });
});

describe('migrateDingTalkPluginRegistrations', () => {
  it('collapses official plugin allow/entries onto dingtalk', () => {
    const config = {
      plugins: {
        allow: ['dingtalk-connector', 'custom-plugin'],
        entries: {
          'dingtalk-connector': { enabled: true },
        },
      },
    };

    expect(migrateDingTalkPluginRegistrations(config)).toBe(true);
    expect(config.plugins.allow).toEqual(['custom-plugin', 'dingtalk']);
    expect(config.plugins.entries).toEqual({
      dingtalk: { enabled: true },
    });
  });
});

describe('ensureDingTalkPluginActivation', () => {
  it('writes plugins.allow and plugins.entries.dingtalk', () => {
    const config: { plugins?: Record<string, unknown> } = {};
    ensureDingTalkPluginActivation(config);
    expect(config.plugins).toEqual({
      allow: ['dingtalk'],
      enabled: true,
      entries: {
        dingtalk: { enabled: true },
      },
    });
  });
});

describe('remapDingTalkOfficialManifest', () => {
  it('remaps official identity onto dingtalk and keeps skills', () => {
    const manifest = {
      id: DINGTALK_OFFICIAL_PLUGIN_ID,
      channels: [DINGTALK_OFFICIAL_PLUGIN_ID],
      skills: ['./skills'],
      channelConfigs: {
        [DINGTALK_OFFICIAL_PLUGIN_ID]: {
          schema: {
            type: 'object',
            additionalProperties: false,
          },
        },
      },
    };

    expect(remapDingTalkOfficialManifest(manifest)).toBe(true);
    expect(manifest.id).toBe(DINGTALK_PLUGIN_ID);
    expect(manifest.channels).toEqual([DINGTALK_PLUGIN_ID]);
    expect(manifest.skills).toEqual(['./skills']);
    expect(manifest.channelConfigs.dingtalk.schema.additionalProperties).toBe(true);
    expect(manifest.channelConfigs[DINGTALK_OFFICIAL_PLUGIN_ID]).toBeUndefined();
  });

  it('does not rewrite unrelated manifests', () => {
    const manifest = { id: 'wecom', channels: ['wecom'] };
    expect(remapDingTalkOfficialManifest(manifest)).toBe(false);
    expect(manifest).toEqual({ id: 'wecom', channels: ['wecom'] });
  });
});

describe('remapDingTalkOfficialPackageJson', () => {
  it('keeps the official npm name and rewrites channel ids', () => {
    const pkg = {
      name: DINGTALK_OFFICIAL_NPM,
      openclaw: {
        channels: [DINGTALK_OFFICIAL_PLUGIN_ID],
        channel: { id: DINGTALK_OFFICIAL_PLUGIN_ID },
      },
    };

    expect(remapDingTalkOfficialPackageJson(pkg)).toBe(true);
    expect(pkg.name).toBe(DINGTALK_OFFICIAL_NPM);
    expect(pkg.openclaw.channels).toEqual([DINGTALK_PLUGIN_ID]);
    expect(pkg.openclaw.channel.id).toBe(DINGTALK_PLUGIN_ID);
  });
});

describe('patchDingTalkChannelIdsInJs', () => {
  it('rewrites exact channel ids but leaves Gateway RPC names intact', () => {
    const source = [
      'const CHANNEL_ID = "dingtalk-connector";',
      'api.registerGatewayMethod("dingtalk-connector.docs.create", handler);',
      "cfg.channels?.['dingtalk-connector']",
    ].join('\n');

    const { content, patched } = patchDingTalkChannelIdsInJs(source);
    expect(patched).toBe(true);
    expect(content).toContain('const CHANNEL_ID = "dingtalk";');
    expect(content).toContain('api.registerGatewayMethod("dingtalk-connector.docs.create", handler);');
    expect(content).toContain("cfg.channels?.['dingtalk']");
  });

  it('patches published official connector chunks without rewriting Gateway RPCs', () => {
    const distDir = resolve(process.cwd(), 'node_modules/@dingtalk-real-ai/dingtalk-connector/dist');
    const files = readdirSync(distDir).filter((name) => name.endsWith('.mjs'));
    expect(files.length).toBeGreaterThan(0);

    let patchedAny = false;
    let keptRpc = false;
    for (const name of files) {
      const source = readFileSync(resolve(distDir, name), 'utf8');
      const { content, patched } = patchDingTalkChannelIdsInJs(source);
      patchedAny = patchedAny || patched;
      if (source.includes('dingtalk-connector.docs.create')) {
        expect(content).toContain('dingtalk-connector.docs.create');
        keptRpc = true;
      }
      expect(content).not.toMatch(/(["'])dingtalk-connector\1/);
    }

    expect(patchedAny).toBe(true);
    expect(keptRpc).toBe(true);
  });
});
