import { describe, expect, it } from 'vitest';
import {
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
});
