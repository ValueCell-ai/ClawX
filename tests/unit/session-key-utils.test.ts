import { describe, expect, it } from 'vitest';
import {
  findHiddenOpenClawHeartbeatSession,
  isChannelSessionKey,
  isClawXDesktopSessionKey,
  isPlaceholderChannelSession,
  shouldIncludeSessionInSidebarList,
} from '@/stores/chat/session-key-utils';
import type { ChatSession } from '@/stores/chat/types';

describe('session-key-utils', () => {
  it('detects feishu and other channel session keys', () => {
    expect(isChannelSessionKey('agent:main:feishu:ou_abc123')).toBe(true);
    expect(isChannelSessionKey('agent:main:telegram:12345')).toBe(true);
    expect(isChannelSessionKey('agent:main:whatsapp:dm:abc')).toBe(true);
  });

  it('treats ClawX desktop session keys as non-channel', () => {
    expect(isChannelSessionKey('agent:main:main')).toBe(false);
    expect(isChannelSessionKey('agent:main:session-1710000000000')).toBe(false);
    expect(isChannelSessionKey('agent:main:cron:heartbeat')).toBe(false);
  });

  it('excludes cron and channel keys from desktop-only session keys', () => {
    expect(isClawXDesktopSessionKey('agent:main:main')).toBe(true);
    expect(isClawXDesktopSessionKey('agent:main:session-1710000000000')).toBe(true);
    expect(isClawXDesktopSessionKey('agent:main:feishu:ou_abc123')).toBe(false);
    expect(isClawXDesktopSessionKey('agent:main:cron:heartbeat')).toBe(false);
  });

  it('detects placeholder channel sessions without any preview/title', () => {
    const placeholder: ChatSession = {
      key: 'agent:main:feishu:ou_abc123',
    };
    expect(isPlaceholderChannelSession(placeholder)).toBe(true);
    expect(shouldIncludeSessionInSidebarList(placeholder)).toBe(false);
  });

  it('includes channel sessions once they have a message preview', () => {
    const active: ChatSession = {
      key: 'agent:main:feishu:ou_abc123',
      lastMessagePreview: 'feishu:ou_abc123',
    };
    expect(isPlaceholderChannelSession(active)).toBe(false);
    expect(shouldIncludeSessionInSidebarList(active)).toBe(true);
  });

  it('includes channel sessions with a derived title', () => {
    const titled: ChatSession = {
      key: 'agent:main:feishu:ou_abc123',
      derivedTitle: '飞书对话',
    };
    expect(isPlaceholderChannelSession(titled)).toBe(false);
    expect(shouldIncludeSessionInSidebarList(titled)).toBe(true);
  });

  it('keeps non-placeholder channel sessions even if their preview contains the heartbeat sentinel', () => {
    const channelSession: ChatSession = {
      key: 'agent:main:feishu:ou_abc123',
      displayName: 'Alice',
      lastMessagePreview: '[OpenClaw heartbeat poll]',
    };

    expect(isPlaceholderChannelSession(channelSession)).toBe(false);
    expect(shouldIncludeSessionInSidebarList(channelSession)).toBe(true);
  });

  it('hides OpenClaw heartbeat-only desktop sessions from the sidebar', () => {
    const heartbeatOnly: ChatSession = {
      key: 'agent:main:main',
      displayName: 'ClawX',
      lastMessagePreview: '[OpenClaw heartbeat poll]',
    };

    expect(shouldIncludeSessionInSidebarList(heartbeatOnly)).toBe(false);
  });

  it('hides heartbeat sessions whose preview is only the OpenClaw heartbeat acknowledgement', () => {
    const heartbeatOnly: ChatSession = {
      key: 'agent:main:main',
      label: '[OpenClaw heartbeat poll]',
      displayName: '[OpenClaw heartbeat poll]',
      derivedTitle: '[OpenClaw heartbeat poll]',
      lastMessagePreview: 'HEARTBEAT_OK',
    };

    expect(shouldIncludeSessionInSidebarList(heartbeatOnly)).toBe(false);
  });

  it('finds a hidden heartbeat session by current key', () => {
    const sessions: ChatSession[] = [
      {
        key: 'agent:main:main',
        displayName: 'ClawX',
        lastMessagePreview: '[OpenClaw heartbeat poll]',
      },
      {
        key: 'agent:main:session-1710000000000',
        displayName: 'ClawX',
        lastMessagePreview: 'Summarize the repository structure',
      },
    ];

    expect(findHiddenOpenClawHeartbeatSession('agent:main:main', sessions)?.key).toBe('agent:main:main');
    expect(findHiddenOpenClawHeartbeatSession('agent:main:session-1710000000000', sessions)).toBeNull();
  });

  it('does not treat missing metadata as proof of a hidden heartbeat session', () => {
    const sessions: ChatSession[] = [{ key: 'agent:main:main', displayName: 'ClawX' }];

    expect(findHiddenOpenClawHeartbeatSession('agent:main:main', sessions)).toBeNull();
  });

  it('does not hide a real conversation only because it is titled ClawX', () => {
    const realConversation: ChatSession = {
      key: 'agent:main:session-1710000000000',
      label: 'ClawX',
      lastMessagePreview: 'Summarize the repository structure',
    };

    expect(shouldIncludeSessionInSidebarList(realConversation)).toBe(true);
  });

  it('keeps heartbeat-marked sessions when displayName carries a real title', () => {
    const titledConversation: ChatSession = {
      key: 'agent:main:session-1710000000002',
      displayName: 'Project kickoff notes',
      lastMessagePreview: '[OpenClaw heartbeat poll]',
    };

    expect(shouldIncludeSessionInSidebarList(titledConversation)).toBe(true);
  });

  it('keeps sessions that contain user-authored text near the heartbeat sentinel', () => {
    const mixedConversation: ChatSession = {
      key: 'agent:main:session-1710000000001',
      derivedTitle: 'Debug startup',
      lastMessagePreview: 'Why do I see [OpenClaw heartbeat poll] in the sidebar?',
    };

    expect(shouldIncludeSessionInSidebarList(mixedConversation)).toBe(true);
  });
});
