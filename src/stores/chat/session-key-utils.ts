import { CHANNEL_NAMES } from '@shared/types/channel';
import {
  containsOpenClawHeartbeatPollSentinel,
  isOpenClawHeartbeatAckText,
  OPENCLAW_HEARTBEAT_POLL_SENTINEL,
} from '@shared/chat/openclaw-internal';
import { isCronSessionKey } from './cron-session-utils';
import type { ChatSession } from './types';

const CHANNEL_SESSION_SEGMENTS = new Set<string>(Object.keys(CHANNEL_NAMES));
const NON_USER_SESSION_LABELS = new Set(['clawx', 'main']);

function stripHeartbeatSentinel(value: string | undefined): string {
  return (value ?? '').replaceAll(OPENCLAW_HEARTBEAT_POLL_SENTINEL, '').trim();
}

function hasUserAuthoredSessionText(value: string | undefined, sessionKey: string): boolean {
  const text = stripHeartbeatSentinel(value);
  if (!text) return false;
  if (isOpenClawHeartbeatAckText(text)) return false;
  if (text === sessionKey) return false;
  return !NON_USER_SESSION_LABELS.has(text.toLowerCase());
}

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

export function isOpenClawHeartbeatOnlySession(session: ChatSession): boolean {
  if (!isClawXDesktopSessionKey(session.key)) return false;

  const hasHeartbeat = [session.label, session.displayName, session.derivedTitle, session.lastMessagePreview]
    .some(containsOpenClawHeartbeatPollSentinel);
  if (!hasHeartbeat) return false;

  if (hasUserAuthoredSessionText(session.label, session.key)) return false;
  if (hasUserAuthoredSessionText(session.displayName, session.key)) return false;
  if (hasUserAuthoredSessionText(session.derivedTitle, session.key)) return false;
  if (hasUserAuthoredSessionText(session.lastMessagePreview, session.key)) return false;

  return true;
}

export function findHiddenOpenClawHeartbeatSession(sessionKey: string, sessions: ChatSession[]): ChatSession | null {
  const session = sessions.find((candidate) => candidate.key === sessionKey);
  return session && isOpenClawHeartbeatOnlySession(session) ? session : null;
}

export function shouldIncludeSessionInSidebarList(session: ChatSession): boolean {
  if (!session.key) return false;
  // Hide renderer-local placeholders created by New Chat until the first message
  // creates the backing ACP session (acknowledgeAcpSessionCreated clears the flag).
  if (session.createdLocally) return false;
  if (isOpenClawHeartbeatOnlySession(session)) return false;
  if (isChannelSessionKey(session.key)) {
    return !isPlaceholderChannelSession(session);
  }
  return true;
}
