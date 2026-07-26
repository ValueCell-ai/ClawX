import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseCronSessionKey } from './chat/cron-session-utils';
import { projectSessionRunState } from './chat/session-status';
import type { ChatSession } from './chat/types';

export type SessionAttention = {
  observedBusy: boolean;
  unread: boolean;
};

export type SessionAttentionTransition =
  | { type: 'rows'; rows: ChatSession[] }
  | { type: 'delete'; sessionKey: string };

export type SessionAttentionState = {
  bySessionKey: Record<string, SessionAttention>;
  visibleSessionKey: string | null;
  reconcileSessionRows: (rows: ChatSession[]) => void;
  reconcileSessionRowSequence: (rowSnapshots: ChatSession[][]) => void;
  reconcileSessionTransitions: (transitions: SessionAttentionTransition[]) => void;
  setVisibleSession: (sessionKey: string | null) => void;
  markRead: (sessionKey: string) => void;
  removeSession: (sessionKey: string) => void;
};

type PersistedSessionAttentionState = Pick<SessionAttentionState, 'bySessionKey'>;

function reconcileRows(
  bySessionKey: Record<string, SessionAttention>,
  rows: ChatSession[],
  visibleSessionKey: string | null,
): Record<string, SessionAttention> {
  let next = bySessionKey;

  for (const row of rows) {
    if (parseCronSessionKey(row.key)?.runSessionId) continue;

    const projection = projectSessionRunState(row);
    const previous = next[row.key];
    let attention: SessionAttention | undefined;

    if (projection === 'busy' && !previous?.observedBusy) {
      attention = { observedBusy: true, unread: previous?.unread ?? false };
    } else if (projection === 'idle' && previous?.observedBusy) {
      attention = { observedBusy: false, unread: row.key !== visibleSessionKey };
    }

    if (attention) {
      next = { ...next, [row.key]: attention };
    }
  }

  return next;
}

function applyAttentionTransitions(
  bySessionKey: Record<string, SessionAttention>,
  transitions: SessionAttentionTransition[],
  visibleSessionKey: string | null,
): Record<string, SessionAttention> {
  let next = bySessionKey;
  for (const transition of transitions) {
    if (transition.type === 'rows') {
      next = reconcileRows(next, transition.rows, visibleSessionKey);
    } else if (transition.sessionKey in next) {
      next = { ...next };
      delete next[transition.sessionKey];
    }
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePersistedState(value: unknown): PersistedSessionAttentionState {
  if (!isRecord(value) || !isRecord(value.bySessionKey)) return { bySessionKey: {} };

  const entries = Object.entries(value.bySessionKey);
  if (entries.some(([, attention]) => (
    !isRecord(attention)
    || typeof attention.observedBusy !== 'boolean'
    || typeof attention.unread !== 'boolean'
  ))) {
    return { bySessionKey: {} };
  }

  return {
    bySessionKey: Object.fromEntries(entries.map(([sessionKey, attention]) => [
      sessionKey,
      {
        observedBusy: (attention as Record<string, unknown>).observedBusy as boolean,
        unread: (attention as Record<string, unknown>).unread as boolean,
      },
    ])),
  };
}

export const useSessionAttentionStore = create<SessionAttentionState>()(
  persist<SessionAttentionState, [], [], PersistedSessionAttentionState>(
    (set) => ({
      bySessionKey: {},
      visibleSessionKey: null,

      reconcileSessionRows: (rows) => set((state) => {
        const bySessionKey = reconcileRows(state.bySessionKey, rows, state.visibleSessionKey);
        return bySessionKey === state.bySessionKey ? state : { bySessionKey };
      }),

      reconcileSessionRowSequence: (rowSnapshots) => set((state) => {
        const bySessionKey = applyAttentionTransitions(
          state.bySessionKey,
          rowSnapshots.map((rows) => ({ type: 'rows', rows })),
          state.visibleSessionKey,
        );
        return bySessionKey === state.bySessionKey ? state : { bySessionKey };
      }),

      reconcileSessionTransitions: (transitions) => set((state) => {
        const bySessionKey = applyAttentionTransitions(
          state.bySessionKey,
          transitions,
          state.visibleSessionKey,
        );
        return bySessionKey === state.bySessionKey ? state : { bySessionKey };
      }),

      setVisibleSession: (sessionKey) => set((state) => {
        if (sessionKey === null) {
          return state.visibleSessionKey === null ? state : { visibleSessionKey: null };
        }

        const attention = state.bySessionKey[sessionKey];
        if (!attention?.unread) return { visibleSessionKey: sessionKey };

        return {
          visibleSessionKey: sessionKey,
          bySessionKey: {
            ...state.bySessionKey,
            [sessionKey]: { ...attention, unread: false },
          },
        };
      }),

      markRead: (sessionKey) => set((state) => {
        const attention = state.bySessionKey[sessionKey];
        if (!attention?.unread) return state;
        return {
          bySessionKey: {
            ...state.bySessionKey,
            [sessionKey]: { ...attention, unread: false },
          },
        };
      }),

      removeSession: (sessionKey) => set((state) => {
        if (!(sessionKey in state.bySessionKey)) return state;
        return {
          bySessionKey: Object.fromEntries(
            Object.entries(state.bySessionKey).filter(([key]) => key !== sessionKey),
          ),
        };
      }),
    }),
    {
      name: 'clawx.session-attention',
      version: 1,
      partialize: (state) => ({ bySessionKey: state.bySessionKey }),
      migrate: (persistedState) => sanitizePersistedState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedState(persistedState),
      }),
    },
  ),
);
