import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatSession } from '@/stores/chat/types';
import { useSessionAttentionStore } from '@/stores/session-attention';

const STORAGE_KEY = 'clawx.session-attention';
const SESSION_KEY = 'agent:main:main';
const OTHER_KEY = 'agent:main:other';

function row(
  key: string,
  status?: string,
  hasActiveRun?: boolean,
  updatedAt?: number,
): ChatSession {
  return { key, status, hasActiveRun, updatedAt };
}

function persistedState(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
}

async function rehydrate(state: unknown, version = 1): Promise<void> {
  useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
  await useSessionAttentionStore.persist.rehydrate();
}

describe('useSessionAttentionStore', () => {
  beforeEach(() => {
    useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });
    window.localStorage.clear();
  });

  it('does not create unread attention when initially hydrated with an idle row', () => {
    useSessionAttentionStore.getState().reconcileSessionRows([row(SESSION_KEY, 'done', false)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toBeUndefined();
  });

  it('records that a busy session was observed', () => {
    useSessionAttentionStore.getState().reconcileSessionRows([row(SESSION_KEY, 'running', true)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: true,
      unread: false,
    });
  });

  it('creates unread when an observed busy session becomes idle while not visible', () => {
    const store = useSessionAttentionStore.getState();
    store.reconcileSessionRows([row(SESSION_KEY, 'running', true)]);
    store.reconcileSessionRows([row(SESSION_KEY, 'done', false)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: false,
      unread: true,
    });
  });

  it('keeps completion read when the observed session is visible', () => {
    const store = useSessionAttentionStore.getState();
    store.setVisibleSession(SESSION_KEY);
    store.reconcileSessionRows([row(SESSION_KEY, 'running', true)]);
    store.reconcileSessionRows([row(SESSION_KEY, 'done', false)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: false,
      unread: false,
    });
  });

  it('sets visibility and clears existing unread in one store update', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });
    const observed: Array<{ visibleSessionKey: string | null; unread: boolean }> = [];
    const unsubscribe = useSessionAttentionStore.subscribe((state) => {
      observed.push({
        visibleSessionKey: state.visibleSessionKey,
        unread: state.bySessionKey[SESSION_KEY]?.unread ?? false,
      });
    });

    useSessionAttentionStore.getState().setVisibleSession(SESSION_KEY);
    unsubscribe();

    expect(observed).toEqual([{ visibleSessionKey: SESSION_KEY, unread: false }]);
  });

  it('clears visibility without changing attention', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
      visibleSessionKey: SESSION_KEY,
    });

    useSessionAttentionStore.getState().setVisibleSession(null);

    expect(useSessionAttentionStore.getState()).toMatchObject({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
      visibleSessionKey: null,
    });
  });

  it('preserves attention for unknown projections', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: true, unread: true } },
    });

    useSessionAttentionStore.getState().reconcileSessionRows([row(SESSION_KEY, 'queued')]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: true,
      unread: true,
    });
  });

  it('retains an existing unread bit when the session enters busy', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });

    useSessionAttentionStore.getState().reconcileSessionRows([row(SESSION_KEY, 'running', true)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: true,
      unread: true,
    });
  });

  it('does not prune stored attention when a reconciliation omits the session', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });

    useSessionAttentionStore.getState().reconcileSessionRows([row(OTHER_KEY, 'done', false)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]?.unread).toBe(true);
  });

  it('does not create unread from an updatedAt-only row change', () => {
    const store = useSessionAttentionStore.getState();
    store.reconcileSessionRows([row(SESSION_KEY, undefined, undefined, 1)]);
    store.reconcileSessionRows([row(SESSION_KEY, undefined, undefined, 2)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toBeUndefined();
  });

  it('skips run-scoped cron rows without changing the exact base-key attention', () => {
    const baseKey = 'agent:main:cron:daily-job';
    const runKey = `${baseKey}:run:run-id`;
    useSessionAttentionStore.setState({
      bySessionKey: { [baseKey]: { observedBusy: false, unread: true } },
    });

    useSessionAttentionStore.getState().reconcileSessionRows([row(runKey, 'running', true)]);

    expect(useSessionAttentionStore.getState().bySessionKey).toEqual({
      [baseKey]: { observedBusy: false, unread: true },
    });
  });

  it('removes session attention from state and persisted storage', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });

    useSessionAttentionStore.getState().removeSession(SESSION_KEY);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toBeUndefined();
    expect(persistedState()).toEqual({ state: { bySessionKey: {} }, version: 1 });
  });

  it('creates unread from persisted observed-busy state after rehydration', async () => {
    await rehydrate({
      bySessionKey: { [SESSION_KEY]: { observedBusy: true, unread: false } },
    });

    useSessionAttentionStore.getState().reconcileSessionRows([row(SESSION_KEY, 'done', false)]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: false,
      unread: true,
    });
  });

  it('persists only bySessionKey', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: true, unread: false } },
    });

    useSessionAttentionStore.getState().setVisibleSession(SESSION_KEY);

    expect(persistedState()).toEqual({
      state: { bySessionKey: { [SESSION_KEY]: { observedBusy: true, unread: false } } },
      version: 1,
    });
  });

  it('rejects malformed current and migrated persisted attention', async () => {
    await rehydrate({
      bySessionKey: { [SESSION_KEY]: { observedBusy: 'yes', unread: false } },
      visibleSessionKey: SESSION_KEY,
    });
    expect(useSessionAttentionStore.getState()).toMatchObject({
      bySessionKey: {},
      visibleSessionKey: null,
    });

    await rehydrate({ bySessionKey: { [SESSION_KEY]: { observedBusy: true } } }, 0);
    expect(useSessionAttentionStore.getState()).toMatchObject({
      bySessionKey: {},
      visibleSessionKey: null,
    });
  });

  it('folds an ordered busy-to-idle sequence into one final store update', () => {
    const observed: Array<Record<string, { observedBusy: boolean; unread: boolean }>> = [];
    const unsubscribe = useSessionAttentionStore.subscribe((state) => {
      observed.push(state.bySessionKey);
    });

    useSessionAttentionStore.getState().reconcileSessionRowSequence([
      [row(SESSION_KEY, 'running', true)],
      [row(SESSION_KEY, 'done', false)],
    ]);
    unsubscribe();

    expect(observed).toEqual([
      { [SESSION_KEY]: { observedBusy: false, unread: true } },
    ]);
  });

  it('folds delete then recreated busy-to-idle as new attention in one update', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });
    const observed: Array<Record<string, { observedBusy: boolean; unread: boolean }>> = [];
    const unsubscribe = useSessionAttentionStore.subscribe((state) => {
      observed.push(state.bySessionKey);
    });

    useSessionAttentionStore.getState().reconcileSessionTransitions([
      { type: 'delete', sessionKey: SESSION_KEY },
      { type: 'rows', rows: [row(SESSION_KEY, 'running', true)] },
      { type: 'rows', rows: [row(SESSION_KEY, 'done', false)] },
    ]);
    unsubscribe();

    expect(observed).toEqual([
      { [SESSION_KEY]: { observedBusy: false, unread: true } },
    ]);
  });

  it('clears old unread before folding a recreated busy row', () => {
    useSessionAttentionStore.setState({
      bySessionKey: { [SESSION_KEY]: { observedBusy: false, unread: true } },
    });

    useSessionAttentionStore.getState().reconcileSessionTransitions([
      { type: 'delete', sessionKey: SESSION_KEY },
      { type: 'rows', rows: [row(SESSION_KEY, 'running', true)] },
    ]);

    expect(useSessionAttentionStore.getState().bySessionKey[SESSION_KEY]).toEqual({
      observedBusy: true,
      unread: false,
    });
  });
});
