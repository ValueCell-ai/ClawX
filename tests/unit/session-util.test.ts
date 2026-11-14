// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionDeliveryMetadata, readAgentSessionRecords, resolveAccountIdFromSessionHistory } from '../../electron/utils/session-util';

const fixture = vi.hoisted(() => ({ stateDir: '' }));
vi.mock('../../electron/utils/paths', () => ({
  getOpenClawConfigDir: () => fixture.stateDir,
  resolveOpenClawStateDir: () => fixture.stateDir,
}));

describe('persisted session delivery metadata', () => {
  it('reads canonical external metadata without mixing stale compatibility fields', () => {
    expect(getSessionDeliveryMetadata({
      delivery: {
        kind: 'external',
        context: { channel: 'openclaw-weixin', accountId: 'wx-new', to: 'CaseSensitive@im.wechat' },
        origin: { label: 'Recipient', chatType: 'direct' },
      },
      deliveryContext: { channel: 'telegram', accountId: 'old', to: 'wrong' },
      origin: { label: 'Stale recipient' },
      lastTo: 'also-wrong',
    })).toEqual({
      channel: 'openclaw-weixin', accountId: 'wx-new', to: 'CaseSensitive@im.wechat', label: 'Recipient', chatType: 'direct',
    });
  });

  it.each(['none', 'internal', 'unknown'])('does not resurrect legacy fields for canonical %s state', (kind) => {
    expect(getSessionDeliveryMetadata({
      delivery: { kind },
      deliveryContext: { channel: 'wechat', accountId: 'old', to: 'stale@im.wechat' },
    })).toEqual({});
  });

  it('uses canonical origin fallbacks without borrowing an account from legacy fields', () => {
    expect(getSessionDeliveryMetadata({
      delivery: { kind: 'external', origin: { provider: 'wechat', to: 'Peer@im.wechat' } },
      lastAccountId: 'unrelated',
    })).toMatchObject({ channel: 'wechat', to: 'Peer@im.wechat', accountId: undefined });
  });

  it('supports legacy deliveryContext, last-route and origin formats', () => {
    const expected = { channel: 'wechat', accountId: 'wx-old', to: 'Peer@im.wechat' };
    expect(getSessionDeliveryMetadata({ deliveryContext: expected })).toMatchObject(expected);
    expect(getSessionDeliveryMetadata({ lastChannel: 'wechat', lastAccountId: 'wx-old', lastTo: 'Peer@im.wechat' }))
      .toMatchObject(expected);
    expect(getSessionDeliveryMetadata({ origin: { provider: 'wechat', accountId: 'wx-old', to: 'Peer@im.wechat' } }))
      .toMatchObject(expected);
  });
});

describe('0.6.1 session delivery upgrade compatibility', () => {
  beforeEach(async () => { fixture.stateDir = await mkdtemp(join(tmpdir(), 'clawx-delivery-upgrade-')); });
  afterEach(async () => { await rm(fixture.stateDir, { recursive: true, force: true }); });

  it.each(['keyed', 'array'])('preserves recipients from %s legacy JSON through native normalization and SQLite', async (format) => {
    // Use the pinned Doctor normalizer, not a reimplementation of its migration.
    const runtimeDir = resolve('node_modules/openclaw/dist');
    const files = (await readdir(runtimeDir)).filter(name => /^state-migrations\.legacy-session-store-.*\.mjs$/.test(name));
    expect(files).toHaveLength(1);
    const runtime = createRequire(import.meta.url)(join(runtimeDir, files[0])) as Record<string, unknown>;
    const normalize = Object.values(runtime).find(value => typeof value === 'function' && value.name === 'normalizeLegacySessionEntryDelivery') as
      ((entry: Record<string, unknown>) => Record<string, unknown>);
    expect(normalize).toBeTypeOf('function');
    const cases = [
      { agent: 'main', channel: 'openclaw-weixin', accountId: 'old-main-im-bot', to: 'MixedCasePrimary@im.wechat', source: 'context' },
      { agent: 'secondary', channel: 'openclaw-weixin', accountId: 'old-second-im-bot', to: 'MixedCaseSecondary@im.wechat', source: 'origin' },
      { agent: 'main', channel: 'telegram', accountId: 'old-telegram', to: '123456789', source: 'last' },
      { agent: 'main', channel: 'wecom', accountId: 'old-wecom', to: 'wecom:LegacyGroup', source: 'context' },
      { agent: 'main', channel: 'dingtalk', accountId: 'old-dingtalk', to: 'cidLegacyGroup', source: 'context' },
    ];
    for (const agent of ['main', 'secondary']) {
      const sessionsDir = join(fixture.stateDir, 'agents', agent, 'sessions');
      await mkdir(sessionsDir, { recursive: true });
      const entries = cases.filter(item => item.agent === agent).map(({ channel, accountId, to, source }) => ({
        sessionId: randomUUID(), updatedAt: 100,
        ...(source === 'context' ? { deliveryContext: { channel, accountId, to } } : {}),
        ...(source === 'origin' ? { origin: { provider: channel, accountId, to, chatType: 'direct' } } : {}),
        ...(source === 'last' ? { lastChannel: channel, lastAccountId: accountId, lastTo: to } : {}),
      }));
      await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify(format === 'array'
        ? { sessions: entries }
        : Object.fromEntries(entries.map((entry, index) => [`agent:${agent}:legacy-${index}`, entry]))));
    }
    const verify = async () => {
      for (const { agent, channel, accountId, to } of cases) {
        const deliveries = (await readAgentSessionRecords(agent)).map(getSessionDeliveryMetadata);
        expect(deliveries).toContainEqual(expect.objectContaining({ channel, accountId, to }));
        expect(await resolveAccountIdFromSessionHistory(to, channel)).toBe(accountId);
      }
    };
    await verify();

    for (const agent of ['main', 'secondary']) {
      const legacy = await readAgentSessionRecords(agent);
      const agentDir = join(fixture.stateDir, 'agents', agent, 'agent');
      await mkdir(agentDir, { recursive: true });
      const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
      try {
        db.exec('CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)');
        for (const [index, entry] of legacy.entries()) {
          const migrated = normalize(entry);
          expect(migrated).toMatchObject({ delivery: { kind: 'external' } });
          expect(migrated).not.toHaveProperty('deliveryContext');
          expect(migrated).not.toHaveProperty('lastAccountId');
          expect(migrated).not.toHaveProperty('origin');
          db.prepare('INSERT INTO session_nodes VALUES (?, ?)').run(`agent:${agent}:legacy-${index}`, JSON.stringify(migrated));
        }
      } finally { db.close(); }
      // A retained old index cannot override the migrated account/recipient.
      await writeFile(join(fixture.stateDir, 'agents', agent, 'sessions', 'sessions.json'), JSON.stringify({ stale: {
        deliveryContext: { channel: 'openclaw-weixin', accountId: 'wrong-bot', to: 'WrongPeer@im.wechat' },
      } }));
    }
    await verify();
    expect(await resolveAccountIdFromSessionHistory('WrongPeer@im.wechat', 'wechat')).toBeNull();
    // Reads do not rewrite the retained pre-migration JSON.
    expect(await readFile(join(fixture.stateDir, 'agents', 'main', 'sessions', 'sessions.json'), 'utf8')).toContain('wrong-bot');
  });
});
