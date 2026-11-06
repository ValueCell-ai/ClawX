import { describe, expect, it } from 'vitest';
import { materializeLegacyAgentRoles } from '@electron/utils/openclaw-legacy-agent-roles';

type Config = Record<string, unknown>;

function roster(defaults?: Record<string, unknown>) {
  return {
    entries: { main: {}, writer: {} },
    ...(defaults ? { defaults } : {}),
  };
}

describe('materializeLegacyAgentRoles', () => {
  it('preserves a named legacy owner across ambient roles and a fixed session store', () => {
    const config: Config = {
      agents: roster({ workspace: 'D:/workspaces/shared' }),
      channels: { feishu: {}, dingtalk: { enabled: true } },
      session: { store: 'D:/sessions/legacy.json' },
      talk: { voiceId: 'synthetic-voice' },
    };

    materializeLegacyAgentRoles(config, 'writer');

    expect(config).toEqual({
      agents: roster({
        workspace: 'D:/workspaces/shared',
        heartbeat: { agentId: 'writer' },
        systemAgent: { agentId: 'writer' },
        authInheritance: { agentId: 'writer' },
        sessionStore: { agentId: 'writer' },
      }),
      channels: { feishu: {}, dingtalk: { enabled: true } },
      session: { store: 'D:/sessions/legacy.json' },
      talk: { voiceId: 'synthetic-voice', agentId: 'writer' },
      bindings: [
        { agentId: 'writer', match: { channel: 'dingtalk', accountId: '*' } },
        { agentId: 'writer', match: { channel: 'feishu', accountId: '*' } },
      ],
    });
    const once = structuredClone(config);
    materializeLegacyAgentRoles(config, 'writer');
    expect(config).toEqual(once);
  });

  it('does not replace explicit owners, disabled roles, or existing heartbeat policy', () => {
    const config: Config = {
      agents: roster({
        heartbeat: { every: '0m' },
        systemAgent: { agentId: null },
        authInheritance: { agentId: 'main' },
        sessionStore: { agentId: false },
      }),
      session: { store: 'D:/sessions/legacy.json' },
      talk: { agentId: null },
    };
    const before = structuredClone(config);

    materializeLegacyAgentRoles(config, 'writer');

    expect(config).toEqual(before);
  });

  it('fills only unset owners while preserving other authored role settings', () => {
    const config: Config = {
      agents: roster({
        heartbeat: {},
        systemAgent: {},
        authInheritance: { mode: 'merge' },
        sessionStore: {},
      }),
      session: { store: 'D:/sessions/legacy.json' },
    };

    materializeLegacyAgentRoles(config, 'writer');

    expect(config.agents).toEqual(roster({
      heartbeat: {},
      systemAgent: { agentId: 'writer' },
      authInheritance: { mode: 'merge', agentId: 'writer' },
      sessionStore: { agentId: 'writer' },
    }));
  });

  it.each([undefined, '', '  ', 'D:/sessions/{agentId}/sessions.json'])(
    'does not pin session ownership for a per-agent or default store (%s)', (store) => {
      const config: Config = { agents: roster(), session: { store } };

      materializeLegacyAgentRoles(config, 'writer');

      expect((config.agents as { defaults: Config }).defaults).not.toHaveProperty('sessionStore');
    },
  );

  it('does not add auth inheritance when the old owner is already the multi-agent fallback', () => {
    const config: Config = { agents: roster() };

    materializeLegacyAgentRoles(config, 'MAIN');

    expect(config.agents).toEqual(roster({
      heartbeat: { agentId: 'main' },
      systemAgent: { agentId: 'main' },
    }));
  });

  it('preserves per-agent heartbeat responsibility in both roster shapes', () => {
    for (const agents of [
      { entries: { main: { heartbeat: { every: '0m' } }, writer: {} } },
      { list: [{ id: 'main', heartbeat: { every: '0m' } }, { id: 'writer', default: true }] },
    ]) {
      const config: Config = { agents };
      materializeLegacyAgentRoles(config, 'writer');
      expect((config.agents as { defaults: Config }).defaults).not.toHaveProperty('heartbeat');
    }
  });

  it('preserves scoped bindings and adds only missing channel-wide routing fallbacks', () => {
    const bindings = [
      { agentId: 'main', match: { channel: ' LARK ', accountId: '*' } },
      { agentId: 'main', match: { channel: 'qqbot', accountId: 'bot-1' } },
      { agentId: 'main', match: { channel: 'wecom', accountId: '*', peer: { id: 'group-1' } } },
      { type: 'acp', agentId: 'main', match: { channel: 'dingtalk', accountId: '*' } },
      { agentId: 'main', match: { channel: 'discord', accountId: '*', guildId: 'guild-1' } },
      { agentId: 'main', match: { channel: 'slack', accountId: '*', teamId: 'team-1' } },
      { agentId: 'main', match: { channel: 'telegram', accountId: '*', roles: ['admin'] } },
    ];
    const config: Config = {
      agents: roster(),
      channels: {
        feishu: {}, qqbot: {}, wecom: {}, dingtalk: {}, discord: {}, slack: {}, telegram: {},
        whatsapp: { enabled: false }, defaults: { groupPolicy: 'allowlist' }, modelByChannel: {},
      },
      bindings: structuredClone(bindings),
    };

    materializeLegacyAgentRoles(config, 'writer');

    expect(config.bindings).toEqual([
      ...bindings,
      ...['dingtalk', 'discord', 'qqbot', 'slack', 'telegram', 'wecom'].map((channel) => ({
        agentId: 'writer', match: { channel, accountId: '*' },
      })),
    ]);
  });

  it('does not overwrite malformed settings while materializing independent valid surfaces', () => {
    const config: Config = {
      agents: { ...roster(), defaults: 'malformed' },
      channels: { feishu: {} },
      bindings: { malformed: true },
      talk: false,
    };
    const before = structuredClone(config);

    materializeLegacyAgentRoles(config, 'writer');

    expect(config).toEqual(before);
  });

  it('recognizes official channel aliases when a wildcard binding already owns the channel', () => {
    const config: Config = {
      agents: roster(),
      channels: { 'enterprise-wechat': {}, 'openclaw-weixin': {}, 'twitch-chat': {} },
      bindings: [
        { agentId: 'main', match: { channel: 'wecom', accountId: '*' } },
        { agentId: 'main', match: { channel: 'wechat', accountId: '*' } },
        { agentId: 'main', match: { channel: 'twitch', accountId: '*' } },
      ],
    };
    const before = structuredClone(config.bindings);

    materializeLegacyAgentRoles(config, 'writer');

    expect(config.bindings).toEqual(before);
  });
});
