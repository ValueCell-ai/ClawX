export const LAST_CHAT_SESSION_KEY = 'clawx.chat.lastSessionKey';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPersistableSessionKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('agent:');
}

export function readLastChatSessionKey(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const value = storage.getItem(LAST_CHAT_SESSION_KEY);
    return isPersistableSessionKey(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastChatSessionKey(sessionKey: string | null | undefined): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (isPersistableSessionKey(sessionKey)) {
      storage.setItem(LAST_CHAT_SESSION_KEY, sessionKey);
    } else {
      storage.removeItem(LAST_CHAT_SESSION_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}
