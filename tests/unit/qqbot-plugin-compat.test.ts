// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  QQBOT_APPROVALS_DISABLED_SENTINEL,
  liftQQBotChannelSection,
  migrateQQBotChannelSection,
  migrateQQBotPluginRegistrations,
  resolveQQBotRootDefaultAccount,
} from '@electron/utils/qqbot-plugin-compat';

const OPEN_DM = { allowFrom: [QQBOT_APPROVALS_DISABLED_SENTINEL], dmPolicy: 'open' };

describe('migrateQQBotChannelSection', () => {
  it('moves the ClawX default account to the root and keeps open DMs open', () => {
    const config: Record<string, unknown> = {
      channels: {
        qqbot: {
          enabled: true,
          appId: 'app-default',
          clientSecret: 'secret-default',
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'app-default', clientSecret: 'secret-default' },
            agent2: { enabled: true, appId: 'app-2', clientSecret: 'secret-2' },
          },
        },
      },
    };

    expect(migrateQQBotChannelSection(config)).toBe(true);
    expect((config.channels as Record<string, unknown>).qqbot).toEqual({
      enabled: true,
      appId: 'app-default',
      clientSecret: 'secret-default',
      ...OPEN_DM,
      accounts: {
        agent2: { enabled: true, appId: 'app-2', clientSecret: 'secret-2', ...OPEN_DM },
      },
    });
    expect(migrateQQBotChannelSection(config)).toBe(false);
  });

  it('keeps a named default first when the root only mirrors it', () => {
    const config: Record<string, unknown> = {
      channels: {
        qqbot: {
          enabled: true,
          appId: 'app-b',
          clientSecret: 'secret-b',
          defaultAccount: 'b',
          accounts: {
            a: { enabled: true, appId: 'app-a', clientSecret: 'secret-a' },
            b: { enabled: true, appId: 'app-b', clientSecret: 'secret-b' },
          },
        },
      },
    };

    expect(migrateQQBotChannelSection(config)).toBe(true);
    const qqbot = (config.channels as Record<string, Record<string, unknown>>).qqbot;
    expect(qqbot).toEqual({
      enabled: true,
      ...OPEN_DM,
      accounts: {
        b: { enabled: true, appId: 'app-b', clientSecret: 'secret-b', ...OPEN_DM },
        a: { enabled: true, appId: 'app-a', clientSecret: 'secret-a', ...OPEN_DM },
      },
    });
    expect(Object.keys(qqbot.accounts as object)).toEqual(['b', 'a']);
  });

  it('normalizes explicit allowlists without opening DMs', () => {
    const config: Record<string, unknown> = {
      channels: {
        qqbot: {
          appId: 'app',
          clientSecret: 'secret',
          dmPolicy: 'allowlist',
          allowFrom: ['qqbot:abc', 'ABC', 'def'],
        },
      },
    };

    expect(migrateQQBotChannelSection(config)).toBe(true);
    expect((config.channels as Record<string, unknown>).qqbot).toEqual({
      appId: 'app',
      clientSecret: 'secret',
      dmPolicy: 'allowlist',
      allowFrom: ['ABC', 'DEF'],
    });
  });

  it('replaces a wildcard allowlist with the approval marker', () => {
    const config: Record<string, unknown> = {
      channels: { qqbot: { appId: 'app', clientSecret: 'secret', allowFrom: ['*', 'user1'] } },
    };

    migrateQQBotChannelSection(config);
    expect((config.channels as Record<string, unknown>).qqbot).toEqual({
      appId: 'app',
      clientSecret: 'secret',
      allowFrom: ['USER1'],
      dmPolicy: 'open',
    });
  });

  it.each([
    ['execApprovals', { execApprovals: { enabled: true } }],
    ['clientSecretFile', { clientSecretFile: '/secret' }],
    ['legacy streaming transport', { streaming: { nativeTransport: true } }],
    ['group command policy', { groups: { g1: { commandLevel: 'admin' } } }],
  ])('leaves %s for OpenClaw Doctor', (_label, extra) => {
    const qqbot = { appId: 'app', clientSecret: 'secret', defaultAccount: 'default', ...extra };
    const config: Record<string, unknown> = { channels: { qqbot: structuredClone(qqbot) } };

    expect(migrateQQBotChannelSection(config)).toBe(false);
    expect((config.channels as Record<string, unknown>).qqbot).toEqual(qqbot);
  });

  it('leaves command allowlists for OpenClaw Doctor', () => {
    const config: Record<string, unknown> = {
      commands: { allowFrom: { qqbot: ['USER1'] } },
      channels: { qqbot: { appId: 'app', clientSecret: 'secret' } },
    };
    expect(migrateQQBotChannelSection(config)).toBe(false);
  });

  it('does not guess when a hand-written root sits next to a different named default', () => {
    const qqbot = {
      appId: 'app-root',
      clientSecret: 'secret-root',
      defaultAccount: 'b',
      accounts: { b: { appId: 'app-b', clientSecret: 'secret-b' } },
    };
    const config: Record<string, unknown> = { channels: { qqbot: structuredClone(qqbot) } };

    expect(migrateQQBotChannelSection(config)).toBe(false);
    expect((config.channels as Record<string, unknown>).qqbot).toEqual(qqbot);
  });
});

describe('QQBot 2.0 shape round-trip through the ClawX account model', () => {
  it('reads the root as the default account only when it has credentials', () => {
    expect(resolveQQBotRootDefaultAccount({
      enabled: true,
      appId: 'app',
      clientSecret: 'secret',
      ...OPEN_DM,
      accounts: { b: { appId: 'app-b' } },
    })).toEqual({ enabled: true, appId: 'app', clientSecret: 'secret', ...OPEN_DM });
    expect(resolveQQBotRootDefaultAccount({ enabled: true, ...OPEN_DM, accounts: { b: {} } })).toBeUndefined();
    expect(resolveQQBotRootDefaultAccount({ appId: 'app', defaultAccount: 'default' })).toBeUndefined();
  });

  it('selects the first named account when lifting a root without credentials', () => {
    const section: Record<string, unknown> = {
      enabled: true,
      ...OPEN_DM,
      accounts: { b: { appId: 'app-b' }, a: { appId: 'app-a' } },
    };
    liftQQBotChannelSection(section);
    expect(section).toEqual({
      enabled: true,
      defaultAccount: 'b',
      accounts: { b: { appId: 'app-b' }, a: { appId: 'app-a' } },
    });
  });

  it('leaves credentialed roots for the generic account lift', () => {
    const section: Record<string, unknown> = { appId: 'app', clientSecret: 'secret', ...OPEN_DM };
    liftQQBotChannelSection(section);
    expect(section).toEqual({ appId: 'app', clientSecret: 'secret', ...OPEN_DM });
  });
});

describe('migrateQQBotPluginRegistrations', () => {
  it('moves qqbot activation onto openclaw-qqbot and keeps entry settings', () => {
    const config: Record<string, unknown> = {
      plugins: {
        allow: ['discord', 'qqbot'],
        entries: { qqbot: { enabled: true, hooks: { allowPromptInjection: false } } },
      },
    };

    expect(migrateQQBotPluginRegistrations(config)).toBe(true);
    expect(config.plugins).toEqual({
      allow: ['discord', 'openclaw-qqbot'],
      entries: { 'openclaw-qqbot': { enabled: true, hooks: { allowPromptInjection: false } } },
    });
    expect(migrateQQBotPluginRegistrations(config)).toBe(false);
  });
});
