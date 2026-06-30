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

function getAgentScopedSessionSuffix(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  return parts.slice(2).join(':');
}

/**
 * Gateway may register channel sessions before any user message (preview is just
 * the peer id). Those should not appear in ClawX until there is real activity.
 */
export function isPlaceholderChannelSession(session: ChatSession): boolean {
  if (!isChannelSessionKey(session.key)) return false;
  if (session.derivedTitle?.trim()) return false;
  if (session.displayName?.trim() && session.displayName !== session.key) return false;

  const suffix = getAgentScopedSessionSuffix(session.key);
  const preview = session.lastMessagePreview?.trim();
  if (!preview) return true;
  if (preview === session.key || (suffix != null && preview === suffix)) return true;

  return false;
}

export function shouldIncludeSessionInSidebarList(session: ChatSession): boolean {
  if (!session.key) return false;
  if (isChannelSessionKey(session.key)) {
    return !isPlaceholderChannelSession(session);
  }
  return true;
}
