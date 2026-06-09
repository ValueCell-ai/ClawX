// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CcConnectBridgeAdapter,
  toCcConnectBridgeSessionKey,
} from '@electron/runtime/cc-connect-bridge-adapter';

describe('cc-connect bridge adapter persisted sessions', () => {
  let tempDir: string;
  let sessionStoreDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-bridge-adapter-'));
    sessionStoreDir = join(tempDir, 'data', 'sessions');
    await mkdir(sessionStoreDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('only maps ClawX agent sessions to bridge session keys', () => {
    expect(toCcConnectBridgeSessionKey('agent:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('agent:research:desk')).toBe('clawx:research:desk');
    expect(toCcConnectBridgeSessionKey('clawx:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('feishu:chat-1:user-1')).toBe('feishu:chat-1:user-1');
  });

  it('lists and reads cc-connect channel sessions from the persisted session store', async () => {
    await writeFile(join(sessionStoreDir, 'clawx-main_abc.json'), JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          name: 'Feishu DM',
          agent_session_id: 'codex-old-session',
          agent_type: 'codex',
          history: [
            { role: 'user', content: '你在吗', timestamp: 1_780_900_000_000 },
            { role: 'assistant', content: '在。有什么需要我处理？', timestamp: 1_780_900_001_000 },
          ],
          created_at: 1_780_900_000_000,
          updated_at: 1_780_900_001_000,
        },
        s2: {
          id: 's2',
          name: 'ClawX Main',
          agent_type: 'codex',
          history: [
            { role: 'user', content: 'hello from app', timestamp: 1_780_800_000_000 },
          ],
          created_at: 1_780_800_000_000,
          updated_at: 1_780_800_000_000,
        },
      },
      active_session: {
        'feishu:oc_chat:ou_user': 's1',
        'clawx:main:main': 's2',
      },
      user_meta: {
        'feishu:oc_chat:ou_user': {
          chat_name: '网关',
          user_name: 'channel-user',
        },
      },
    }), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toMatchObject([
      {
        key: 'feishu:oc_chat:ou_user',
        displayName: '网关 / channel-user',
        updatedAt: 1_780_900_001_000,
      },
      {
        key: 'agent:main:main',
        displayName: 'hello from app',
        updatedAt: 1_780_800_000_000,
      },
    ]);
    await expect(adapter.loadHistory('feishu:oc_chat:ou_user')).resolves.toMatchObject([
      { role: 'user', content: '你在吗' },
      { role: 'assistant', content: '在。有什么需要我处理？' },
    ]);
    await expect(adapter.loadHistory('agent:main:main')).resolves.toMatchObject([
      { role: 'user', content: 'hello from app' },
    ]);
    await expect(adapter.summarizeSessions(['feishu:oc_chat:ou_user', 'agent:main:main'])).resolves.toEqual([
      {
        sessionKey: 'feishu:oc_chat:ou_user',
        firstUserText: '你在吗',
        lastTimestamp: 1_780_900_001_000,
      },
      {
        sessionKey: 'agent:main:main',
        firstUserText: 'hello from app',
        lastTimestamp: 1_780_800_000_000,
      },
    ]);
  });

  it('deletes persisted channel sessions without dropping unrelated sessions', async () => {
    const storePath = join(sessionStoreDir, 'clawx-main_abc.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        s1: { id: 's1', history: [{ role: 'user', content: 'channel' }], updated_at: 10 },
        s2: { id: 's2', agent_session_id: 'keep-agent-session', history: [{ role: 'user', content: 'app' }], updated_at: 20 },
      },
      active_session: {
        'feishu:oc_chat:ou_user': 's1',
        'clawx:main:main': 's2',
      },
      user_sessions: {
        'feishu:oc_chat:ou_user': ['s1'],
        'clawx:main:main': ['s2'],
      },
      user_meta: {
        'feishu:oc_chat:ou_user': { chat_name: '网关' },
      },
    }), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await adapter.deleteSession('feishu:oc_chat:ou_user');

    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, unknown>;
      active_session: Record<string, unknown>;
      user_sessions: Record<string, unknown>;
      user_meta: Record<string, unknown>;
    };
    expect(stored.sessions.s1).toBeUndefined();
    expect(stored.sessions.s2).toMatchObject({ agent_session_id: 'keep-agent-session', updated_at: 20 });
    expect(stored.active_session['feishu:oc_chat:ou_user']).toBeUndefined();
    expect(stored.active_session['clawx:main:main']).toBe('s2');
    expect(stored.user_sessions['feishu:oc_chat:ou_user']).toBeUndefined();
    expect(stored.user_meta['feishu:oc_chat:ou_user']).toBeUndefined();
  });
});
