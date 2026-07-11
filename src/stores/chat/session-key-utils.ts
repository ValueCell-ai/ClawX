import { CHANNEL_NAMES } from '@shared/types/channel';
import { isCronSessionKey } from './cron-session-utils';
import type { ChatSession } from './types';

const CHANNEL_SESSION_SEGMENTS = new Set<string>(Object.keys(CHANNEL_NAMES));

/**
 * OpenClaw channel sessions use `agent:<id>:<channel>:...` (e.g. feishu DM keys).
 */
export function isChannelSessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('agent:')) return false;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return false;
  return CHANNEL_SESSION_SEGMENTS.has(parts[2] ?? '');
}

export function isClawXDesktopSessionKey(sessionKey: string): boolean {
  return !isCronSessionKey(sessionKey) && !isChannelSessionKey(sessionKey);
}

/**
 * Gateway may register channel sessions before any real user message (e.g. bot
 * added to a group, webhook ping). Hide those placeholder entries from ClawX
 * sidebar — they have no preview text, no derived title, and no display name.
 */
export function isPlaceholderChannelSession(session: ChatSession): boolean {
  if (!isChannelSessionKey(session.key)) return false;
  if (session.lastMessagePreview?.trim()) return false;
  if (session.derivedTitle?.trim()) return false;
  if (session.displayName?.trim() && session.displayName !== session.key) return false;
  return true;
}

export function shouldIncludeSessionInSidebarList(session: ChatSession): boolean {
  if (!session.key) return false;
  if (isChannelSessionKey(session.key)) {
    return !isPlaceholderChannelSession(session);
  }
  return true;
}
