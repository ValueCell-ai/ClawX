import { invokeIpc } from '@/lib/api-client';
import { getCanonicalPrefixFromSessions, getMessageText, toMs } from './helpers';
import { DEFAULT_CANONICAL_PREFIX, DEFAULT_SESSION_KEY, type ChatSession, type RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

import {
  LABEL_FETCH_CONCURRENCY,
  beginSessionLabelHydration,
  clearSessionLabelHydrationTracking,
  finishSessionLabelHydration,
  getSessionLabelHydrationCandidate,
  getSessionLabelHydrationRuntimeKey,
  isSessionLabelHydrationReady,
} from './session-label-hydration';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function toSessionLabel(text: string, maxLength = 50): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function applySessionBackendLabels(set: ChatSet, sessions: ChatSession[]): void {
  const labels = Object.fromEntries(
    sessions
      .filter((session) => !session.key.endsWith(':main'))
      .map((session) => [session.key, toSessionLabel(session.label || session.derivedTitle || '')] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (Object.keys(labels).length === 0) return;
  set((state) => ({
    sessionLabels: {
      ...state.sessionLabels,
      ...Object.fromEntries(
        Object.entries(labels).filter(([key]) => !state.sessionLabels[key]),
      ),
    },
  }));
}

function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function createSessionActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadSessions' | 'switchSession' | 'newSession' | 'deleteSession' | 'renameSession' | 'cleanupEmptySession'> {
  return {
    loadSessions: async () => {
      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'sessions.list',
          {
            includeDerivedTitles: true,
            includeLastMessage: true,
          }
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (result.success && result.result) {
          const data = result.result;
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
          })).filter((s: ChatSession) => s.key);

          const canonicalBySuffix = new Map<string, string>();
          for (const session of sessions) {
            if (!session.key.startsWith('agent:')) continue;
            const parts = session.key.split(':');
            if (parts.length < 3) continue;
            const suffix = parts.slice(2).join(':');
            if (suffix && !canonicalBySuffix.has(suffix)) {
              canonicalBySuffix.set(suffix, session.key);
            }
          }

          // Deduplicate: if both short and canonical existed, keep canonical only
          const seen = new Set<string>();
          const dedupedSessions = sessions.filter((s) => {
            if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
            if (seen.has(s.key)) return false;
            seen.add(s.key);
            return true;
          });

          const { currentSessionKey } = get();
          let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
          if (!nextSessionKey.startsWith('agent:')) {
            const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
            if (canonicalMatch) {
              nextSessionKey = canonicalMatch;
            }
          }
          if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
            // Current session not found in the backend list
            const isNewEmptySession = get().messages.length === 0;
            if (!isNewEmptySession) {
              nextSessionKey = dedupedSessions[0].key;
            }
          }

          const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
            ? [
              ...dedupedSessions,
              { key: nextSessionKey, displayName: nextSessionKey },
            ]
            : dedupedSessions;

          const discoveredActivity = Object.fromEntries(
            sessionsWithCurrent
              .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
              .map((session) => [session.key, session.updatedAt!]),
          );

          set((state) => ({
            sessions: sessionsWithCurrent,
            currentSessionKey: nextSessionKey,
            currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
            sessionLastActivity: {
              ...state.sessionLastActivity,
              ...discoveredActivity,
            },
          }));
          applySessionBackendLabels(set, sessionsWithCurrent);

          const gatewayRuntimeKey = getSessionLabelHydrationRuntimeKey(undefined);
          const shouldHydrateSessionLabels = isSessionLabelHydrationReady(gatewayRuntimeKey, true);

          if (currentSessionKey !== nextSessionKey) {
            get().loadHistory();
          }

          // Background: fetch first user message for every non-main session to populate labels.
          // Concurrency-limited to avoid flooding the gateway with parallel RPCs.
          // By the time this runs, the gateway should already be fully ready (Sidebar
          // gates on gatewayReady), so no startup-retry loop is needed.
          const sessionsToLabel = shouldHydrateSessionLabels
            ? sessionsWithCurrent
              .map((session) => ({
                session,
                candidate: getSessionLabelHydrationCandidate(
                  session,
                  get().sessionLabels,
                  get().sessionLastActivity,
                ),
              }))
              .filter((entry) => entry.candidate != null)
              .map((entry) => ({ session: entry.session, version: entry.candidate!.version }))
            : [];
          if (sessionsToLabel.length > 0) {
            void (async () => {
              for (let i = 0; i < sessionsToLabel.length; i += LABEL_FETCH_CONCURRENCY) {
                const batch = sessionsToLabel.slice(i, i + LABEL_FETCH_CONCURRENCY)
                  .filter(({ session, version }) => beginSessionLabelHydration(session.key, version));
                await Promise.all(
                  batch.map(async ({ session, version }) => {
                    try {
                      const r = await invokeIpc(
                        'gateway:rpc',
                        'chat.history',
                        { sessionKey: session.key, limit: 1000 },
                      ) as { success: boolean; result?: Record<string, unknown>; error?: string };
                      if (!r.success || !r.result) {
                        finishSessionLabelHydration(session.key, version, 'error');
                        return;
                      }
                      const msgs = Array.isArray(r.result.messages) ? r.result.messages as RawMessage[] : [];
                      const firstUser = msgs.find((m) => m.role === 'user');
                      const lastMsg = msgs[msgs.length - 1];
                      const labelText = firstUser ? getMessageText(firstUser.content).trim() : '';
                      set((s) => {
                        const next: Partial<typeof s> = {};
                        if (labelText) {
                          const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
                          next.sessionLabels = { ...s.sessionLabels, [session.key]: truncated };
                        }
                        if (lastMsg?.timestamp) {
                          next.sessionLastActivity = { ...s.sessionLastActivity, [session.key]: toMs(lastMsg.timestamp) };
                        }
                        return next;
                      });
                      finishSessionLabelHydration(session.key, version, labelText ? 'labeled' : 'empty');
                    } catch {
                      finishSessionLabelHydration(session.key, version, 'error');
                    }
                  }),
                );
              }
            })();
          }
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      }
    },

    // ── Switch session ──

    switchSession: (key: string) => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only treat sessions with no history records and no activity timestamp as empty.
      // Relying solely on messages.length is unreliable because switchSession clears
      // the current messages before loadHistory runs, creating a race condition that
      // could cause sessions with real history to be incorrectly removed from the sidebar.
      const leavingEmpty = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      set((s) => ({
        currentSessionKey: key,
        currentAgentId: getAgentIdFromSessionKey(key),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        ...(leavingEmpty ? {
          sessions: s.sessions.filter((s) => s.key !== currentSessionKey),
          sessionLabels: Object.fromEntries(
            Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
          ),
          sessionLastActivity: Object.fromEntries(
            Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
          ),
        } : {}),
      }));
      get().loadHistory();
    },

    // ── Delete session ──
    //
    // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
    // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
    // Deletion is therefore performed locally: the renderer drops the session
    // from the sidebar / labels / activity maps and the Main process hard-deletes
    // the on-disk transcript so it stops appearing in sessions.list and stops
    // contributing to the Dashboard token-usage history.

    deleteSession: async (key: string) => {
      clearSessionLabelHydrationTracking(key);
      // Hard-delete the session's JSONL transcript on disk.
      // The main process unlinks <id>.jsonl plus any leftover
      // <id>.deleted.jsonl and <id>.jsonl.reset.* siblings, then removes the
      // entry from sessions.json so sessions.list stops surfacing it.
      try {
        const result = await invokeIpc('session:delete', key) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
        }
      } catch (err) {
        console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
      }

      const { currentSessionKey, sessions } = get();
      const remaining = sessions.filter((s) => s.key !== key);

      if (currentSessionKey === key) {
        // Switched away from deleted session — pick the first remaining or create new
        const next = remaining[0];
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
          currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
        }));
        if (next) {
          get().loadHistory();
        }
      } else {
        set((s) => ({
          sessions: remaining,
          sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
          sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        }));
      }
    },

    // ── New session ──

    newSession: () => {
      // Generate a new unique session key and switch to it.
      // NOTE: We intentionally do NOT call sessions.reset on the old session.
      // sessions.reset archives (renames) the session JSONL file, making old
      // conversation history inaccessible when the user switches back to it.
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only treat sessions with no history records and no activity timestamp as empty
      const leavingEmpty = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      const prefix = getCanonicalPrefixFromSessions(get().sessions) ?? DEFAULT_CANONICAL_PREFIX;
      const newKey = `${prefix}:session-${Date.now()}`;
      const newSessionEntry: ChatSession = { key: newKey, displayName: newKey };
      set((s) => ({
        currentSessionKey: newKey,
        currentAgentId: getAgentIdFromSessionKey(newKey),
        sessions: [
          ...(leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions),
          newSessionEntry,
        ],
        sessionLabels: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
          : s.sessionLabels,
        sessionLastActivity: leavingEmpty
          ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
          : s.sessionLastActivity,
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
      }));
    },

    // ── Rename session ──

    renameSession: async (key: string, label: string) => {
      const normalized = label.trim();
      if (!normalized) {
        throw new Error('Session label cannot be empty');
      }

      // Persist the new label to sessions.json via IPC
      try {
        const result = await invokeIpc('session:rename', key, normalized) as {
          success: boolean;
          error?: string;
        };
        if (!result.success) {
          throw new Error(result.error || 'Failed to rename session');
        }
      } catch (err) {
        console.error(`[renameSession] IPC call failed for ${key}:`, err);
        throw err;
      }

      // Update local state: both sessions array and sessionLabels
      set((s) => ({
        sessions: s.sessions.map((session) =>
          session.key === key ? { ...session, label: normalized } : session,
        ),
        sessionLabels: { ...s.sessionLabels, [key]: normalized },
      }));
    },

    // ── Cleanup empty session on navigate away ──

    cleanupEmptySession: () => {
      const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
      // Only remove non-main sessions that were never used (no messages sent).
      // This mirrors the "leavingEmpty" logic in switchSession so that creating
      // a new session and immediately navigating away doesn't leave a ghost entry
      // in the sidebar.
      // Also check sessionLastActivity and sessionLabels comprehensively to prevent
      // falsely treating sessions with history as empty due to switchSession clearing messages early.
      const isEmptyNonMain = !currentSessionKey.endsWith(':main')
        && messages.length === 0
        && !sessionLastActivity[currentSessionKey]
        && !sessionLabels[currentSessionKey];
      if (!isEmptyNonMain) return;
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
        sessionLabels: Object.fromEntries(
          Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
        ),
      }));
    },

    // ── Load chat history ──

  };
}
