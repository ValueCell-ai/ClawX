import { create, type StoreApi } from 'zustand';
import { hostApi, type SessionLabelSummary } from '@/lib/host-api';
import {
  isAcpWorkingDirectoryTruncatedTitle,
  isOpenClawSessionIdFallbackTitle,
  stripAcpWorkingDirectoryPrefix,
} from '@shared/chat/session-title';
import {
  isOpenClawHeartbeatPollText,
  OPENCLAW_HEARTBEAT_POLL_SENTINEL,
} from '@shared/chat/openclaw-internal';
import { useGatewayStore } from './gateway';
import { pickStartupSessionFallback } from './chat/session-selection';
import {
  applyGatewaySessionsChanged,
  normalizeGatewaySessionRow,
  type GatewaySessionsChangedPayload,
} from './chat/session-catalog';
import {
  findHiddenOpenClawHeartbeatSession,
  isClawXDesktopSessionKey,
  isOpenClawHeartbeatOnlySession,
  shouldIncludeSessionInSidebarList,
} from './chat/session-key-utils';
import {
  LABEL_FETCH_RETRY_DELAYS_MS,
  abandonSessionLabelHydration,
  beginSessionLabelHydration,
  clearSessionLabelHydrationTracking,
  finishSessionLabelHydration,
  getSessionLabelHydrationCandidate,
  getSessionLabelHydrationVersion,
  isSessionLabelHydrationVersionCurrent,
} from './chat/session-label-hydration';
import { useComposerDraftStore } from './composer-drafts';
import { useSessionAttentionStore, type SessionAttentionTransition } from './session-attention';
import {
  DEFAULT_CANONICAL_PREFIX,
  DEFAULT_SESSION_KEY,
  type ChatSession,
  type ChatState,
} from './chat/types';

export type { ChatSession } from './chat/types';

type ChatSet = StoreApi<ChatState>['setState'];

let loadSessionsInFlight: Promise<void> | null = null;
let lastLoadSessionsAt = 0;
let sessionCatalogGeneration = 0;
let loadSessionsContext: {
  generation: number;
  events: GatewaySessionsChangedPayload[];
} | null = null;
let pendingGenerationSessionEvents: {
  generation: number;
  events: GatewaySessionsChangedPayload[];
} | null = null;
let queuedForcedSessionGeneration: number | null = null;
let standaloneForcedSessionReloadPending = false;
const latestSessionEventTsByKey = new Map<string, number>();
let successfulSessionListTsFloor: number | null = null;
let localSessionCatalogRevision = 0;
const pendingCatalogConfirmationSessionKeys = new Set<string>();
const localDraftSessionKeys = new Set<string>();

const SESSION_LOAD_MIN_INTERVAL_MS = 1_200;

function markLocalSessionCatalogMutation(): void {
  localSessionCatalogRevision += 1;
}

export function synchronizeGatewaySessionGeneration(generation: number): void {
  if (!Number.isFinite(generation) || generation <= sessionCatalogGeneration) return;
  sessionCatalogGeneration = generation;
  latestSessionEventTsByKey.clear();
  successfulSessionListTsFloor = null;
  pendingGenerationSessionEvents = { generation, events: [] };
}

function getSessionsChangedExactKey(payload: GatewaySessionsChangedPayload): string | null {
  const envelopeKey = typeof payload.sessionKey === 'string' && payload.sessionKey.trim()
    ? payload.sessionKey.trim()
    : typeof payload.key === 'string' ? payload.key.trim() : '';
  const nestedKey = typeof payload.session?.key === 'string' ? payload.session.key.trim() : '';
  if (envelopeKey && nestedKey && envelopeKey !== nestedKey) return null;
  return nestedKey || envelopeKey || null;
}

function getSessionEventUncertainty(events: GatewaySessionsChangedPayload[]): {
  keys: Set<string>;
  unscoped: boolean;
} {
  const keys = new Set<string>();
  let unscoped = false;
  for (const event of events) {
    if (typeof event.ts === 'number' && Number.isFinite(event.ts)) continue;
    const eventKey = getSessionsChangedExactKey(event);
    if (eventKey) keys.add(eventKey);
    else unscoped = true;
  }
  return { keys, unscoped };
}

function mergeSessionActivity(
  current: Record<string, number>,
  sessions: ChatSession[],
): Record<string, number> {
  let next = current;
  for (const session of sessions) {
    if (typeof session.updatedAt !== 'number' || !Number.isFinite(session.updatedAt)) continue;
    const activity = Math.max(current[session.key] ?? 0, session.updatedAt);
    if (current[session.key] === activity) continue;
    if (next === current) next = { ...current };
    next[session.key] = activity;
  }
  return next;
}

function isSyntheticSessionFallbackLabel(
  session: ChatSession | undefined,
  label: string | null | undefined,
): boolean {
  return Boolean(session && label && isOpenClawSessionIdFallbackTitle(label, session.sessionId));
}

function hasExplicitSessionLabel(session: ChatSession | undefined): boolean {
  return typeof session?.label === 'string'
    && Boolean(session.label.trim())
    && !isSyntheticSessionFallbackLabel(session, session.label);
}

function cleanSessionLabelText(text: string): string {
  return text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
}

function toSessionLabel(text: string, maxLength = 50): string {
  const cleaned = cleanSessionLabelText(text).trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function toAutomaticSessionLabel(text: string, maxLength = 50): string {
  if (isOpenClawHeartbeatPollText(text) || isAcpWorkingDirectoryTruncatedTitle(text)) return '';
  const textAfterInitialPrefix = stripAcpWorkingDirectoryPrefix(text);
  const cleaned = cleanSessionLabelText(textAfterInitialPrefix);
  const stripCwdExposedByCleanup = !textAfterInitialPrefix.startsWith('[Working directory: ')
    && cleaned.startsWith('[Working directory: ');
  const normalized = stripCwdExposedByCleanup
    ? stripAcpWorkingDirectoryPrefix(cleaned)
    : cleaned;
  const title = normalized.trim();
  if (!title || isOpenClawHeartbeatPollText(title)) return '';
  return title.length > maxLength ? `${title.slice(0, maxLength)}…` : title;
}

function applySessionBackendLabels(set: ChatSet, sessions: ChatSession[]): void {
  set((state) => {
    let nextLabels = state.sessionLabels;

    for (const session of sessions) {
      if (session.key.endsWith(':main')) continue;

      if (hasExplicitSessionLabel(session)) {
        const label = toSessionLabel(session.label || '');
        if (nextLabels[session.key] !== label) {
          if (nextLabels === state.sessionLabels) nextLabels = { ...state.sessionLabels };
          nextLabels[session.key] = label;
        }
        continue;
      }

      const derivedTitle = session.derivedTitle || '';
      const derivedTitleUnavailable = isAcpWorkingDirectoryTruncatedTitle(derivedTitle)
        || isSyntheticSessionFallbackLabel(session, derivedTitle);
      const label = derivedTitleUnavailable ? '' : toAutomaticSessionLabel(derivedTitle);
      if (!label && derivedTitleUnavailable) {
        const cachedLabel = nextLabels[session.key];
        if (cachedLabel === '…' || isSyntheticSessionFallbackLabel(session, cachedLabel)) {
          if (nextLabels === state.sessionLabels) nextLabels = { ...state.sessionLabels };
          delete nextLabels[session.key];
        }
        continue;
      }
      if (label && !nextLabels[session.key]) {
        if (nextLabels === state.sessionLabels) nextLabels = { ...state.sessionLabels };
        nextLabels[session.key] = label;
      }
    }

    return nextLabels === state.sessionLabels ? {} : { sessionLabels: nextLabels };
  });
}

function isHeartbeatOnlySummaryForSession(
  session: ChatSession | undefined,
  summary: SessionLabelSummary,
): boolean {
  if (!session || !isClawXDesktopSessionKey(session.key)) return false;
  if (!summary.heartbeatOnly && !isOpenClawHeartbeatPollText(summary.firstUserText)) return false;
  return isOpenClawHeartbeatOnlySession({
    ...session,
    lastMessagePreview: summary.firstUserText || OPENCLAW_HEARTBEAT_POLL_SENTINEL,
  });
}

function getHeartbeatCachedLabelCleanup(
  sessions: ChatSession[],
  sessionLabels: Record<string, string>,
): { hiddenSessionKeys: Set<string>; labelKeys: Set<string> } {
  const hiddenSessionKeys = new Set<string>();
  const staleLabelKeys = new Set<string>();

  for (const session of sessions) {
    if (!isOpenClawHeartbeatPollText(sessionLabels[session.key])) continue;
    const heartbeatMarkedSession = {
      ...session,
      lastMessagePreview: OPENCLAW_HEARTBEAT_POLL_SENTINEL,
    };
    if (isOpenClawHeartbeatOnlySession(heartbeatMarkedSession)) hiddenSessionKeys.add(session.key);
    else staleLabelKeys.add(session.key);
  }

  return {
    hiddenSessionKeys,
    labelKeys: new Set([...hiddenSessionKeys, ...staleLabelKeys]),
  };
}

function omitRecordKeys<T>(entries: Record<string, T>, keys: Set<string>): Record<string, T> {
  if (keys.size === 0) return entries;
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (keys.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : entries;
}

async function fetchSessionLabelSummaries(sessionKeys: string[]): Promise<SessionLabelSummary[]> {
  if (sessionKeys.length === 0) return [];
  const response = await hostApi.sessions.summaries({ sessionKeys });
  return Array.isArray(response?.summaries) ? response.summaries : [];
}

function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((session) => session.key.startsWith('agent:'))?.key;
  return canonical ? getCanonicalPrefixFromSessionKey(canonical) : null;
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  return sessionKey.split(':')[1] || 'main';
}

function ensureSessionEntry(
  sessions: ChatSession[],
  sessionKey: string,
  options: { createdLocally?: boolean; workspacePath?: string } = {},
): ChatSession[] {
  const existingSession = sessions.find((session) => session.key === sessionKey);
  if (existingSession) {
    if (!options.workspacePath || existingSession.workspacePath === options.workspacePath) return sessions;
    return sessions.map((session) => (
      session.key === sessionKey ? { ...session, workspacePath: options.workspacePath } : session
    ));
  }
  return [...sessions, {
    key: sessionKey,
    displayName: sessionKey,
    ...(options.createdLocally ? { createdLocally: true } : {}),
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
  }];
}

function clearSessionEntryFromMap<T extends Record<string, unknown>>(entries: T, sessionKey: string): T {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => key !== sessionKey)) as T;
}

function buildSessionSwitchPatch(
  state: Pick<ChatState, 'currentSessionKey' | 'sessions' | 'sessionLabels' | 'sessionLastActivity'>,
  nextSessionKey: string,
  options: { createdLocally?: boolean; workspacePath?: string } = {},
): Partial<ChatState> {
  const leavingLocalPlaceholder = state.currentSessionKey !== nextSessionKey
    && state.sessions.some((session) => (
      session.key === state.currentSessionKey && session.createdLocally === true
    ));
  const sessions = leavingLocalPlaceholder
    ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
    : state.sessions;

  return {
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    sessions: ensureSessionEntry(sessions, nextSessionKey, options),
    sessionLabels: leavingLocalPlaceholder
      ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
      : state.sessionLabels,
    sessionLastActivity: leavingLocalPlaceholder
      ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
      : state.sessionLastActivity,
  };
}

function repairMissingCurrentSelection(
  currentSessionKey: string,
  sessions: ChatSession[],
): {
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
} {
  if (sessions.some((session) => session.key === currentSessionKey)) {
    return {
      sessions,
      currentSessionKey,
      currentAgentId: getAgentIdFromSessionKey(currentSessionKey),
    };
  }

  const fallbackKey = pickStartupSessionFallback(currentSessionKey, sessions);
  if (fallbackKey) {
    return {
      sessions,
      currentSessionKey: fallbackKey,
      currentAgentId: getAgentIdFromSessionKey(fallbackKey),
    };
  }

  const prefix = getCanonicalPrefixFromSessionKey(currentSessionKey)
    ?? getCanonicalPrefixFromSessions(sessions)
    ?? DEFAULT_CANONICAL_PREFIX;
  let suffix = Date.now();
  let placeholderKey = `${prefix}:session-${suffix}`;
  while (
    placeholderKey === currentSessionKey
    || sessions.some((session) => session.key === placeholderKey)
  ) {
    suffix += 1;
    placeholderKey = `${prefix}:session-${suffix}`;
  }
  return {
    sessions: ensureSessionEntry(sessions, placeholderKey, { createdLocally: true }),
    currentSessionKey: placeholderKey,
    currentAgentId: getAgentIdFromSessionKey(placeholderKey),
  };
}

function getRemovedSessionKeys(before: ChatSession[], after: ChatSession[]): Set<string> {
  const remainingKeys = new Set(after.map((session) => session.key));
  return new Set(before.filter((session) => !remainingKeys.has(session.key)).map((session) => session.key));
}

function applySessionLabelSummaries(
  set: ChatSet,
  summaries: SessionLabelSummary[],
  requestVersions?: ReadonlyMap<string, string>,
): void {
  if (summaries.length === 0) return;
  set((state) => {
    let nextLabels = state.sessionLabels;
    let nextActivity = state.sessionLastActivity;
    let nextSessions = state.sessions;
    let switchPatch: Partial<ChatState> | null = null;
    let changed = false;

    for (const summary of summaries) {
      const session = nextSessions.find((entry) => entry.key === summary.sessionKey);
      if (requestVersions) {
        const requestVersion = requestVersions.get(summary.sessionKey);
        if (
          !requestVersion
          || !session
          || !isSessionLabelHydrationVersionCurrent(summary.sessionKey, requestVersion)
          || getSessionLabelHydrationVersion(session, nextActivity) !== requestVersion
        ) continue;
      }

      if (isHeartbeatOnlySummaryForSession(session, summary)) {
        nextSessions = nextSessions.filter((entry) => entry.key !== summary.sessionKey);
        nextLabels = clearSessionEntryFromMap(nextLabels, summary.sessionKey);
        nextActivity = clearSessionEntryFromMap(nextActivity, summary.sessionKey);
        changed = true;

        if (state.currentSessionKey === summary.sessionKey) {
          const prefix = getCanonicalPrefixFromSessionKey(summary.sessionKey) ?? DEFAULT_CANONICAL_PREFIX;
          switchPatch = buildSessionSwitchPatch(
            {
              ...state,
              sessions: nextSessions,
              sessionLabels: nextLabels,
              sessionLastActivity: nextActivity,
            },
            `${prefix}:session-${Date.now()}`,
            { createdLocally: true },
          );
          if (switchPatch.sessions) nextSessions = switchPatch.sessions;
          if (switchPatch.sessionLabels) nextLabels = switchPatch.sessionLabels;
          if (switchPatch.sessionLastActivity) nextActivity = switchPatch.sessionLastActivity;
        }
        continue;
      }

      const labelText = toAutomaticSessionLabel(summary.firstUserText || '');
      const existingLabel = nextLabels[summary.sessionKey]?.trim();
      const existingLabelIsFallback = isSyntheticSessionFallbackLabel(session, existingLabel);
      if (labelText && (!existingLabel || existingLabelIsFallback) && !hasExplicitSessionLabel(session)) {
        if (nextLabels === state.sessionLabels) nextLabels = { ...state.sessionLabels };
        nextLabels[summary.sessionKey] = labelText;
        changed = true;
      }

      if (typeof summary.lastTimestamp === 'number' && Number.isFinite(summary.lastTimestamp)) {
        if (nextActivity[summary.sessionKey] !== summary.lastTimestamp) {
          if (nextActivity === state.sessionLastActivity) nextActivity = { ...state.sessionLastActivity };
          nextActivity[summary.sessionKey] = summary.lastTimestamp;
          changed = true;
        }
      }

      const workspacePath = typeof summary.workspacePath === 'string' ? summary.workspacePath.trim() : '';
      if (workspacePath) {
        const sessionIndex = nextSessions.findIndex((entry) => entry.key === summary.sessionKey);
        const existingSession = sessionIndex >= 0 ? nextSessions[sessionIndex] : undefined;
        if (existingSession && existingSession.workspacePath !== workspacePath) {
          if (nextSessions === state.sessions) nextSessions = [...state.sessions];
          nextSessions[sessionIndex] = { ...existingSession, workspacePath };
          changed = true;
        }
      }
    }

    if (!changed) return {};
    if (nextSessions !== state.sessions || switchPatch?.currentSessionKey) {
      markLocalSessionCatalogMutation();
    }
    const patch: Partial<ChatState> = switchPatch ? { ...switchPatch } : {};
    if (nextLabels !== state.sessionLabels) patch.sessionLabels = nextLabels;
    if (nextActivity !== state.sessionLastActivity) patch.sessionLastActivity = nextActivity;
    if (nextSessions !== state.sessions) patch.sessions = nextSessions;
    return patch;
  });
}

function isGatewayStartupError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes('unavailable during gateway startup')
    || message.includes('unavailable during startup')
    || message.includes('not yet ready')
    || message.includes('service not initialized');
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChatSessionsList(): Promise<Record<string, unknown>> {
  return useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {
    includeDerivedTitles: true,
    includeLastMessage: true,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},

  loadSessions: async (options) => {
    const requestedGeneration = options?.gatewayGeneration;
    if (typeof requestedGeneration === 'number' && Number.isFinite(requestedGeneration)) {
      if (requestedGeneration < sessionCatalogGeneration) return;
      synchronizeGatewaySessionGeneration(requestedGeneration);
    }

    const now = Date.now();
    if (loadSessionsInFlight) {
      let observedFlight = loadSessionsInFlight;
      if (options?.force) {
        queuedForcedSessionGeneration = Math.max(
          queuedForcedSessionGeneration ?? sessionCatalogGeneration,
          sessionCatalogGeneration,
        );
      }
      while (observedFlight) {
        await observedFlight;
        if (!options?.force) break;
        const successorFlight = loadSessionsInFlight;
        if (!successorFlight || successorFlight === observedFlight) break;
        observedFlight = successorFlight;
      }
      return;
    }
    if (!options?.force && now - lastLoadSessionsAt < SESSION_LOAD_MIN_INTERVAL_MS) return;

    const runFlight = async (initialGeneration: number): Promise<void> => {
      let generation = initialGeneration;
      let internalFollowUpUsed = false;
      let previousGatewayListKeys: Set<string> | null = null;
      const suppressedSessionKeys = new Set<string>();
      const advanceGeneration = (nextGeneration: number): void => {
        if (nextGeneration !== generation) {
          previousGatewayListKeys = null;
          suppressedSessionKeys.clear();
        }
        generation = nextGeneration;
      };

      while (true) {
        const pendingEvents = pendingGenerationSessionEvents?.generation === generation
          ? pendingGenerationSessionEvents.events
          : [];
        if (pendingGenerationSessionEvents?.generation === generation) {
          pendingGenerationSessionEvents = null;
        }
        const context = { generation, events: pendingEvents };
        loadSessionsContext = context;
        let needsFollowUp = false;

        try {
          const localRevisionBeforeRequest = localSessionCatalogRevision;
          const data = await fetchChatSessionsList();
          if (generation === sessionCatalogGeneration) {
            const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
            const normalizedSessions = rawSessions.map((session) => (
              normalizeGatewaySessionRow(session as Record<string, unknown>)
            ));
            const normalizedSessionKeys = new Set(normalizedSessions.map((session) => session.key));
            const sessions = normalizedSessions.filter(shouldIncludeSessionInSidebarList);

            const canonicalBySuffix = new Map<string, string>();
            for (const session of sessions) {
              if (!session.key.startsWith('agent:')) continue;
              const parts = session.key.split(':');
              if (parts.length < 3) continue;
              const suffix = parts.slice(2).join(':');
              if (suffix && !canonicalBySuffix.has(suffix)) canonicalBySuffix.set(suffix, session.key);
            }

            const seen = new Set<string>();
            const dedupedSessions = sessions.filter((session) => {
              if (!session.key.startsWith('agent:') && canonicalBySuffix.has(session.key)) return false;
              if (seen.has(session.key)) return false;
              seen.add(session.key);
              return true;
            });

            const {
              currentSessionKey,
              sessions: localSessions,
              sessionLabels: currentSessionLabels,
              sessionLastActivity: currentSessionActivity,
            } = get();
            const localSessionByKey = new Map(
              localSessions.map((session) => [session.key, session] as const),
            );
            const mergedSessions = dedupedSessions.map((session) => {
              const localSession = localSessionByKey.get(session.key);
              const workspacePath = session.workspacePath ?? localSession?.workspacePath;
              const preserveLocalDraft = localSession?.createdLocally === true
                && localDraftSessionKeys.has(session.key);
              if (!preserveLocalDraft && workspacePath === session.workspacePath) return session;
              return {
                ...session,
                ...(workspacePath ? { workspacePath } : {}),
                ...(preserveLocalDraft ? { createdLocally: true } : {}),
              };
            });

            if (previousGatewayListKeys) {
              const currentKeys = new Set(localSessions.map((session) => session.key));
              for (const sessionKey of previousGatewayListKeys) {
                if (!currentKeys.has(sessionKey)) suppressedSessionKeys.add(sessionKey);
              }
            }
            previousGatewayListKeys = new Set(mergedSessions.map((session) => session.key));

            const heartbeatCleanup = getHeartbeatCachedLabelCleanup(mergedSessions, currentSessionLabels);
            for (const sessionKey of heartbeatCleanup.hiddenSessionKeys) {
              clearSessionLabelHydrationTracking(sessionKey);
            }
            let visibleMergedSessions = heartbeatCleanup.hiddenSessionKeys.size > 0
              ? mergedSessions.filter((session) => !heartbeatCleanup.hiddenSessionKeys.has(session.key))
              : mergedSessions;
            if (suppressedSessionKeys.size > 0) {
              visibleMergedSessions = visibleMergedSessions.filter(
                (session) => !suppressedSessionKeys.has(session.key),
              );
            }
            const pendingConfirmationSessions = localSessions.filter((session) => (
              pendingCatalogConfirmationSessionKeys.has(session.key)
              && !normalizedSessionKeys.has(session.key)
            ));
            if (pendingConfirmationSessions.length > 0) {
              visibleMergedSessions = [...visibleMergedSessions, ...pendingConfirmationSessions];
            }

            const listTs = typeof data.ts === 'number' && Number.isFinite(data.ts) ? data.ts : undefined;
            const uncertainty = getSessionEventUncertainty(context.events);
            const toOrderableAttentionRows = (rows: ChatSession[]): ChatSession[] => (
              uncertainty.keys.size === 0
                ? rows
                : rows.filter((session) => !uncertainty.keys.has(session.key))
            );
            const attentionTransitions: SessionAttentionTransition[] = [
              { type: 'rows', rows: toOrderableAttentionRows(visibleMergedSessions) },
            ];
            const removedSessionKeys = new Set<string>();
            const observedPendingConfirmationKeys = new Set(
              [...pendingCatalogConfirmationSessionKeys].filter((key) => normalizedSessionKeys.has(key)),
            );
            const attentionOrderIsReliable = listTs !== undefined && !uncertainty.unscoped;

            if (listTs === undefined) {
              needsFollowUp = true;
            } else {
              successfulSessionListTsFloor = Math.max(successfulSessionListTsFloor ?? -Infinity, listTs);
              for (const session of visibleMergedSessions) {
                latestSessionEventTsByKey.set(
                  session.key,
                  Math.max(latestSessionEventTsByKey.get(session.key) ?? -Infinity, listTs),
                );
              }
            }

            for (const event of context.events) {
              const eventTs = typeof event.ts === 'number' && Number.isFinite(event.ts)
                ? event.ts
                : undefined;
              if (listTs === undefined || eventTs === undefined) {
                needsFollowUp = true;
                continue;
              }
              if (eventTs < listTs) continue;

              const sessionsBeforeEvent = visibleMergedSessions;
              const result = applyGatewaySessionsChanged(
                visibleMergedSessions,
                event,
                latestSessionEventTsByKey,
              );
              const eventRemovedSessionKeys = getRemovedSessionKeys(
                sessionsBeforeEvent,
                result.sessions,
              );
              if (result.deletedKey) eventRemovedSessionKeys.add(result.deletedKey);
              if (result.applied) {
                visibleMergedSessions = result.sessions;
                const eventKey = getSessionsChangedExactKey(event);
                if (eventKey && pendingCatalogConfirmationSessionKeys.has(eventKey)) {
                  observedPendingConfirmationKeys.add(eventKey);
                }
                if (eventRemovedSessionKeys.size > 0) {
                  for (const removedKey of eventRemovedSessionKeys) {
                    clearSessionLabelHydrationTracking(removedKey);
                    useComposerDraftStore.getState().clearDraft(removedKey);
                    if (!uncertainty.keys.has(removedKey)) {
                      attentionTransitions.push({ type: 'delete', sessionKey: removedKey });
                    }
                  }
                } else {
                  attentionTransitions.push({
                    type: 'rows',
                    rows: toOrderableAttentionRows(visibleMergedSessions),
                  });
                }
              }
              for (const removedKey of eventRemovedSessionKeys) removedSessionKeys.add(removedKey);
              if (result.requiresReload) needsFollowUp = true;
            }

            const labelCleanupKeys = new Set([
              ...heartbeatCleanup.labelKeys,
              ...removedSessionKeys,
            ]);
            const activityCleanupKeys = new Set([
              ...heartbeatCleanup.hiddenSessionKeys,
              ...removedSessionKeys,
            ]);

            let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
            let replacedHiddenHeartbeatSession = false;
            const hiddenCurrentSession = findHiddenOpenClawHeartbeatSession(
              nextSessionKey,
              normalizedSessions,
            );
            if (hiddenCurrentSession || heartbeatCleanup.hiddenSessionKeys.has(nextSessionKey)) {
              const prefix = getCanonicalPrefixFromSessionKey(nextSessionKey)
                ?? getCanonicalPrefixFromSessions(sessions)
                ?? DEFAULT_CANONICAL_PREFIX;
              nextSessionKey = `${prefix}:session-${Date.now()}`;
              replacedHiddenHeartbeatSession = true;
            }
            if (!nextSessionKey.startsWith('agent:')) {
              const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
              if (canonicalMatch) nextSessionKey = canonicalMatch;
            }
            if (removedSessionKeys.has(nextSessionKey)) {
              const selection = repairMissingCurrentSelection(nextSessionKey, visibleMergedSessions);
              visibleMergedSessions = selection.sessions;
              nextSessionKey = selection.currentSessionKey;
            }
            if (
              !replacedHiddenHeartbeatSession
              && !visibleMergedSessions.some((session) => session.key === nextSessionKey)
              && visibleMergedSessions.length > 0
            ) {
              const hasLocalPendingSession = localSessions.some(
                (session) => session.key === nextSessionKey && session.createdLocally,
              );
              if (!hasLocalPendingSession) {
                const fallbackKey = pickStartupSessionFallback(nextSessionKey, visibleMergedSessions);
                if (fallbackKey) nextSessionKey = fallbackKey;
              }
            }

            const localCurrentSession = localSessions.find((session) => session.key === nextSessionKey);
            const currentSessionToInsert = localCurrentSession
              && (
                localCurrentSession.createdLocally
                || pendingCatalogConfirmationSessionKeys.has(nextSessionKey)
              )
              ? localCurrentSession
              : {
                  ...(localCurrentSession ?? {
                    key: nextSessionKey,
                    displayName: nextSessionKey,
                  }),
                  createdLocally: true,
                };
            let sessionsWithCurrent = !visibleMergedSessions.some((session) => session.key === nextSessionKey)
              && nextSessionKey
              && isClawXDesktopSessionKey(nextSessionKey)
              ? [
                  ...visibleMergedSessions,
                  currentSessionToInsert,
                ]
              : visibleMergedSessions;

            const selectedSession = sessionsWithCurrent.find(
              (session) => session.key === nextSessionKey,
            );
            const hydrationCandidates = sessionsWithCurrent
              .map((session) => ({
                session,
                candidate: getSessionLabelHydrationCandidate(
                  session,
                  currentSessionLabels,
                  currentSessionActivity,
                  { includeWorkspacePath: true },
                ),
              }))
              .filter((entry) => entry.candidate != null)
              .map((entry) => ({ session: entry.session, version: entry.candidate!.version }));
            const selectedCandidate = selectedSession && !selectedSession.createdLocally
              && !selectedSession.workspacePath?.trim()
              ? hydrationCandidates.find(({ session }) => session.key === selectedSession.key)
              : undefined;
            const processedEventCount = context.events.length;
            let selectedSummary: SessionLabelSummary | undefined;
            let awaitedSummaries: SessionLabelSummary[] | null = null;
            let awaitedHydrationFailed = false;
            let awaitedHydrations: typeof hydrationCandidates = [];

            if (selectedSession && selectedCandidate) {
              awaitedHydrations = hydrationCandidates.filter(({ session, version }) => (
                beginSessionLabelHydration(session.key, version)
              ));
              for (let attempt = 0; attempt <= LABEL_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
                try {
                  const summaries = await fetchSessionLabelSummaries(
                    awaitedHydrations.map(({ session }) => session.key),
                  );
                  if (generation !== sessionCatalogGeneration) {
                    for (const { session, version } of awaitedHydrations) {
                      abandonSessionLabelHydration(session.key, version);
                    }
                    break;
                  }
                  awaitedSummaries = summaries;
                  selectedSummary = summaries.find(
                    (summary) => summary.sessionKey === selectedSession.key,
                  );
                  break;
                } catch (error) {
                  const retryableStartup = isGatewayStartupError(error);
                  if (!retryableStartup || attempt >= LABEL_FETCH_RETRY_DELAYS_MS.length) {
                    awaitedHydrationFailed = true;
                    break;
                  }
                  for (const { session, version } of awaitedHydrations) {
                    abandonSessionLabelHydration(session.key, version);
                  }
                  await delay(LABEL_FETCH_RETRY_DELAYS_MS[attempt]!);
                  if (generation !== sessionCatalogGeneration) break;
                  awaitedHydrations = hydrationCandidates.filter(({ session, version }) => (
                    beginSessionLabelHydration(session.key, version)
                  ));
                  if (awaitedHydrations.length === 0) break;
                }
              }
            }

            const lateEvents = context.events.slice(processedEventCount);
            const localCatalogChanged = localSessionCatalogRevision !== localRevisionBeforeRequest;
            const canPublish = generation === sessionCatalogGeneration
              && lateEvents.length === 0
              && !localCatalogChanged;
            if (!canPublish) {
              for (const { session, version } of awaitedHydrations) {
                abandonSessionLabelHydration(session.key, version);
              }
            }
            if (localCatalogChanged && generation === sessionCatalogGeneration) {
              queuedForcedSessionGeneration = Math.max(
                queuedForcedSessionGeneration ?? generation,
                generation,
              );
            }
            if (lateEvents.length > 0 && generation === sessionCatalogGeneration) {
              const pendingEvents = pendingGenerationSessionEvents?.generation === generation
                ? pendingGenerationSessionEvents.events
                : [];
              pendingGenerationSessionEvents = {
                generation,
                events: [...pendingEvents, ...lateEvents],
              };
              needsFollowUp = true;
            }

            if (canPublish) {
              for (const key of observedPendingConfirmationKeys) {
                pendingCatalogConfirmationSessionKeys.delete(key);
              }
              if (selectedSummary && isHeartbeatOnlySummaryForSession(selectedSession, selectedSummary)) {
                sessionsWithCurrent = sessionsWithCurrent.filter(
                  (session) => session.key !== selectedSummary!.sessionKey,
                );
                labelCleanupKeys.add(selectedSummary.sessionKey);
                activityCleanupKeys.add(selectedSummary.sessionKey);
                attentionTransitions.push({
                  type: 'delete',
                  sessionKey: selectedSummary.sessionKey,
                });
                const selection = repairMissingCurrentSelection(nextSessionKey, sessionsWithCurrent);
                sessionsWithCurrent = selection.sessions;
                nextSessionKey = selection.currentSessionKey;
              } else if (selectedSummary?.workspacePath?.trim()) {
                const workspacePath = selectedSummary.workspacePath.trim();
                sessionsWithCurrent = sessionsWithCurrent.map((session) => (
                  session.key === selectedSummary!.sessionKey
                    ? { ...session, workspacePath }
                    : session
                ));
              }

              if (attentionOrderIsReliable) {
                useSessionAttentionStore.getState().reconcileSessionTransitions(attentionTransitions);
              }
              set((state) => {
                const selectedCatalogSession = selectedSummary
                  ? sessionsWithCurrent.find((session) => session.key === selectedSummary.sessionKey)
                  : undefined;
                let sessionLabels = omitRecordKeys(state.sessionLabels, labelCleanupKeys);
                let sessionLastActivity = mergeSessionActivity(
                  omitRecordKeys(state.sessionLastActivity, activityCleanupKeys),
                  sessionsWithCurrent,
                );
                const summaryLabel = selectedSummary && selectedCatalogSession
                  ? toAutomaticSessionLabel(selectedSummary.firstUserText || '')
                  : '';
                if (
                  summaryLabel
                  && !sessionLabels[selectedSummary!.sessionKey]
                  && !hasExplicitSessionLabel(selectedCatalogSession)
                ) {
                  sessionLabels = { ...sessionLabels, [selectedSummary!.sessionKey]: summaryLabel };
                }
                if (
                  selectedSummary
                  && selectedCatalogSession
                  && typeof selectedSummary.lastTimestamp === 'number'
                  && Number.isFinite(selectedSummary.lastTimestamp)
                ) {
                  sessionLastActivity = {
                    ...sessionLastActivity,
                    [selectedSummary.sessionKey]: selectedSummary.lastTimestamp,
                  };
                }
                return {
                  sessions: sessionsWithCurrent,
                  currentSessionKey: nextSessionKey,
                  currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
                  sessionLabels,
                  sessionLastActivity,
                };
              });
              applySessionBackendLabels(set, sessionsWithCurrent);
              if (awaitedSummaries) {
                applySessionLabelSummaries(
                  set,
                  awaitedSummaries,
                  new Map(awaitedHydrations.map(
                    ({ session, version }) => [session.key, version],
                  )),
                );
              }
              for (const { session, version } of awaitedHydrations) {
                const summary = awaitedSummaries?.find(
                  (entry) => entry.sessionKey === session.key,
                );
                const labelText = toAutomaticSessionLabel(summary?.firstUserText || '');
                finishSessionLabelHydration(
                  session.key,
                  version,
                  awaitedHydrationFailed ? 'error' : labelText ? 'labeled' : 'empty',
                );
              }

              const existingSessionLabels = get().sessionLabels;
              const existingSessionActivity = get().sessionLastActivity;
              const sessionsToLabel = sessionsWithCurrent
                .map((session) => ({
                  session,
                  candidate: getSessionLabelHydrationCandidate(
                    session,
                    existingSessionLabels,
                    existingSessionActivity,
                    { includeWorkspacePath: true },
                  ),
                }))
                .filter((entry) => entry.candidate != null)
                .map((entry) => ({ session: entry.session, version: entry.candidate!.version }));

              if (sessionsToLabel.length > 0) {
                void (async () => {
                  let pending = sessionsToLabel.filter(({ session, version }) => (
                    beginSessionLabelHydration(session.key, version)
                  ));
                  for (let attempt = 0; attempt <= LABEL_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
                    try {
                      const summaries = await fetchSessionLabelSummaries(
                        pending.map(({ session }) => session.key),
                      );
                      applySessionLabelSummaries(
                        set,
                        summaries,
                        new Map(pending.map(({ session, version }) => [session.key, version])),
                      );
                      const summaryBySessionKey = new Map(
                        summaries.map((summary) => [summary.sessionKey, summary]),
                      );
                      for (const { session, version } of pending) {
                        const summary = summaryBySessionKey.get(session.key);
                        const labelText = toAutomaticSessionLabel(summary?.firstUserText || '');
                        finishSessionLabelHydration(session.key, version, labelText ? 'labeled' : 'empty');
                      }
                      break;
                    } catch (error) {
                      const retryableStartup = isGatewayStartupError(error);
                      for (const { session, version } of pending) {
                        if (retryableStartup) abandonSessionLabelHydration(session.key, version);
                        else finishSessionLabelHydration(session.key, version, 'error');
                      }
                      if (!retryableStartup || attempt >= LABEL_FETCH_RETRY_DELAYS_MS.length) break;
                      await delay(LABEL_FETCH_RETRY_DELAYS_MS[attempt]!);
                      pending = pending.filter(({ session, version }) => (
                        beginSessionLabelHydration(session.key, version)
                      ));
                      if (pending.length === 0) break;
                    }
                  }
                })();
              }
            }
          }
        } catch (error) {
          console.warn('Failed to load sessions:', error);
          if (generation === sessionCatalogGeneration) {
            let reducedSessions = get().sessions;
            const uncertainty = getSessionEventUncertainty(context.events);
            const toOrderableAttentionRows = (rows: ChatSession[]): ChatSession[] => (
              uncertainty.keys.size === 0
                ? rows
                : rows.filter((session) => !uncertainty.keys.has(session.key))
            );
            const attentionTransitions: SessionAttentionTransition[] = [];
            const removedSessionKeys = new Set<string>();
            const observedPendingConfirmationKeys = new Set<string>();
            let appliedAny = false;

            for (const event of context.events) {
              if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) continue;
              if (successfulSessionListTsFloor !== null && event.ts < successfulSessionListTsFloor) continue;
              const sessionsBeforeEvent = reducedSessions;
              const result = applyGatewaySessionsChanged(
                reducedSessions,
                event,
                latestSessionEventTsByKey,
              );
              const eventRemovedSessionKeys = getRemovedSessionKeys(
                sessionsBeforeEvent,
                result.sessions,
              );
              if (result.deletedKey) eventRemovedSessionKeys.add(result.deletedKey);
              if (result.applied) {
                appliedAny = true;
                reducedSessions = result.sessions;
                const eventKey = getSessionsChangedExactKey(event);
                if (eventKey && pendingCatalogConfirmationSessionKeys.has(eventKey)) {
                  observedPendingConfirmationKeys.add(eventKey);
                }
                if (eventRemovedSessionKeys.size > 0) {
                  for (const removedKey of eventRemovedSessionKeys) {
                    clearSessionLabelHydrationTracking(removedKey);
                    useComposerDraftStore.getState().clearDraft(removedKey);
                    if (!uncertainty.keys.has(removedKey)) {
                      attentionTransitions.push({ type: 'delete', sessionKey: removedKey });
                    }
                  }
                } else {
                  attentionTransitions.push({
                    type: 'rows',
                    rows: toOrderableAttentionRows(reducedSessions),
                  });
                }
              }
              for (const removedKey of eventRemovedSessionKeys) removedSessionKeys.add(removedKey);
            }

            if (appliedAny) {
              for (const key of observedPendingConfirmationKeys) {
                pendingCatalogConfirmationSessionKeys.delete(key);
              }
              if (!uncertainty.unscoped && attentionTransitions.length > 0) {
                useSessionAttentionStore.getState().reconcileSessionTransitions(attentionTransitions);
              }
              set((state) => {
                let sessionLabels = state.sessionLabels;
                let sessionLastActivity = state.sessionLastActivity;
                for (const removedKey of removedSessionKeys) {
                  sessionLabels = clearSessionEntryFromMap(sessionLabels, removedKey);
                  sessionLastActivity = clearSessionEntryFromMap(sessionLastActivity, removedKey);
                }
                const selection = repairMissingCurrentSelection(
                  state.currentSessionKey,
                  reducedSessions,
                );
                return {
                  sessions: selection.sessions,
                  sessionLabels,
                  sessionLastActivity: mergeSessionActivity(sessionLastActivity, selection.sessions),
                  currentSessionKey: selection.currentSessionKey,
                  currentAgentId: selection.currentAgentId,
                };
              });
              applySessionBackendLabels(set, get().sessions);
            }
            needsFollowUp = true;
          }
        } finally {
          if (loadSessionsContext === context) loadSessionsContext = null;
          lastLoadSessionsAt = Date.now();
        }

        const queuedGeneration = queuedForcedSessionGeneration;
        if (queuedGeneration !== null) {
          queuedForcedSessionGeneration = null;
          advanceGeneration(queuedGeneration);
          internalFollowUpUsed = false;
          continue;
        }
        if (needsFollowUp && !internalFollowUpUsed) {
          internalFollowUpUsed = true;
          advanceGeneration(sessionCatalogGeneration);
          continue;
        }
        break;
      }
    };

    let activeFlight = runFlight(sessionCatalogGeneration);
    loadSessionsInFlight = activeFlight;
    try {
      while (true) {
        await activeFlight;
        const queuedGeneration = queuedForcedSessionGeneration;
        if (queuedGeneration === null) break;
        queuedForcedSessionGeneration = null;
        if (queuedGeneration < sessionCatalogGeneration) continue;
        activeFlight = runFlight(queuedGeneration);
        loadSessionsInFlight = activeFlight;
      }
    } finally {
      if (loadSessionsInFlight === activeFlight) loadSessionsInFlight = null;
    }
  },

  handleSessionsChanged: (payload) => {
    if (loadSessionsContext?.generation === sessionCatalogGeneration) {
      loadSessionsContext.events.push(payload);
      return;
    }
    if (pendingGenerationSessionEvents?.generation === sessionCatalogGeneration) {
      pendingGenerationSessionEvents.events.push(payload);
      return;
    }

    const requestForcedReload = (): void => {
      if (standaloneForcedSessionReloadPending) return;
      standaloneForcedSessionReloadPending = true;
      void get().loadSessions({
        force: true,
        gatewayGeneration: sessionCatalogGeneration,
      }).finally(() => {
        standaloneForcedSessionReloadPending = false;
      });
    };

    if (typeof payload.ts !== 'number' || !Number.isFinite(payload.ts)) {
      requestForcedReload();
      return;
    }
    if (successfulSessionListTsFloor !== null && payload.ts < successfulSessionListTsFloor) return;

    const sessionsBeforeEvent = get().sessions;
    const result = applyGatewaySessionsChanged(
      sessionsBeforeEvent,
      payload,
      latestSessionEventTsByKey,
    );
    if (result.applied) {
      const removedSessionKeys = getRemovedSessionKeys(sessionsBeforeEvent, result.sessions);
      if (result.deletedKey) removedSessionKeys.add(result.deletedKey);
      const eventKey = typeof payload.session?.key === 'string'
        ? payload.session.key.trim()
          : typeof payload.sessionKey === 'string'
            ? payload.sessionKey.trim()
            : typeof payload.key === 'string' ? payload.key.trim() : '';
      if (eventKey) pendingCatalogConfirmationSessionKeys.delete(eventKey);
      const affectedRow = result.sessions.find((session) => session.key === eventKey);
      if (affectedRow) useSessionAttentionStore.getState().reconcileSessionRows([affectedRow]);
      for (const removedKey of removedSessionKeys) {
        clearSessionLabelHydrationTracking(removedKey);
        useComposerDraftStore.getState().clearDraft(removedKey);
        useSessionAttentionStore.getState().removeSession(removedKey);
      }
      set((state) => {
        let sessionLabels = state.sessionLabels;
        let sessionLastActivity = state.sessionLastActivity;
        for (const removedKey of removedSessionKeys) {
          sessionLabels = clearSessionEntryFromMap(sessionLabels, removedKey);
          sessionLastActivity = clearSessionEntryFromMap(sessionLastActivity, removedKey);
        }
        const selection = repairMissingCurrentSelection(state.currentSessionKey, result.sessions);
        return {
          sessions: selection.sessions,
          sessionLabels,
          sessionLastActivity: mergeSessionActivity(sessionLastActivity, selection.sessions),
          currentSessionKey: selection.currentSessionKey,
          currentAgentId: selection.currentAgentId,
        };
      });
      applySessionBackendLabels(set, get().sessions);
    }
    if (result.requiresReload) requestForcedReload();
  },

  switchSession: (key) => {
    const { currentSessionKey, sessions } = get();
    if (key === currentSessionKey) return;
    if (sessions.some((session) => session.key === currentSessionKey && session.createdLocally)) {
      useComposerDraftStore.getState().clearDraft(currentSessionKey);
    }
    markLocalSessionCatalogMutation();
    set((state) => buildSessionSwitchPatch(state, key));
  },

  selectAcpSession: (key, workspacePath) => {
    const { currentSessionKey, sessions } = get();
    if (
      key === currentSessionKey
      && (!workspacePath || sessions.find((session) => session.key === key)?.workspacePath === workspacePath)
    ) return;
    if (sessions.some((session) => session.key === currentSessionKey && session.createdLocally)) {
      localDraftSessionKeys.delete(currentSessionKey);
      useComposerDraftStore.getState().clearDraft(currentSessionKey);
    }
    if (!sessions.some((session) => session.key === key)) localDraftSessionKeys.add(key);
    markLocalSessionCatalogMutation();
    set((state) => buildSessionSwitchPatch(state, key, { createdLocally: true, workspacePath }));
  },

  newSession: () => {
    const { currentSessionKey, sessions } = get();
    const prefix = getCanonicalPrefixFromSessionKey(currentSessionKey)
      ?? getCanonicalPrefixFromSessions(sessions)
      ?? DEFAULT_CANONICAL_PREFIX;
    const sessionKey = `${prefix}:session-${Date.now()}`;
    if (sessions.some((session) => session.key === currentSessionKey && session.createdLocally)) {
      localDraftSessionKeys.delete(currentSessionKey);
      useComposerDraftStore.getState().clearDraft(currentSessionKey);
    }
    localDraftSessionKeys.add(sessionKey);
    markLocalSessionCatalogMutation();
    set((state) => buildSessionSwitchPatch(
      state,
      sessionKey,
      { createdLocally: true },
    ));
  },

  acknowledgeAcpSessionCreated: (key, workspacePath, initialPrompt) => {
    const normalizedWorkspacePath = workspacePath?.trim();
    const initialLabel = key.endsWith(':main') ? '' : toSessionLabel(initialPrompt || '');
    localDraftSessionKeys.delete(key);
    pendingCatalogConfirmationSessionKeys.add(key);
    markLocalSessionCatalogMutation();
    set((state) => {
      const sessionEntry = state.sessions.find((session) => session.key === key);
      return {
        sessions: sessionEntry
          ? state.sessions.map((session) => (
              session.key === key && session.createdLocally
                ? (() => {
                    const acknowledgedSession = { ...session };
                    delete acknowledgedSession.createdLocally;
                    return {
                      ...acknowledgedSession,
                      ...(normalizedWorkspacePath ? { workspacePath: normalizedWorkspacePath } : {}),
                    };
                  })()
                : session
            ))
          : [...state.sessions, {
              key,
              displayName: key,
              ...(normalizedWorkspacePath ? { workspacePath: normalizedWorkspacePath } : {}),
            }],
        ...(initialLabel && !hasExplicitSessionLabel(sessionEntry) && !state.sessionLabels[key]
          ? { sessionLabels: { ...state.sessionLabels, [key]: initialLabel } }
          : {}),
      };
    });
  },

  deleteSession: async (key) => {
    try {
      const result = await hostApi.sessions.delete(key);
      if (!result.success) {
        const error = result.error || 'Failed to delete session';
        console.warn(`[deleteSession] API reported failure for ${key}:`, error);
        return { success: false, error };
      }
    } catch (error) {
      console.warn(`[deleteSession] API call failed for ${key}:`, error);
      return { success: false, error: String(error) };
    }

    clearSessionLabelHydrationTracking(key);
    localDraftSessionKeys.delete(key);
    useComposerDraftStore.getState().clearDraft(key);
    useSessionAttentionStore.getState().removeSession(key);
    pendingCatalogConfirmationSessionKeys.delete(key);

    markLocalSessionCatalogMutation();
    set((state) => {
      const remaining = state.sessions.filter((session) => session.key !== key);
      const selection = state.currentSessionKey === key
        ? repairMissingCurrentSelection(state.currentSessionKey, remaining)
        : {
            sessions: remaining,
            currentSessionKey: state.currentSessionKey,
            currentAgentId: state.currentAgentId,
          };
      return {
        sessions: selection.sessions,
        sessionLabels: clearSessionEntryFromMap(state.sessionLabels, key),
        sessionLastActivity: clearSessionEntryFromMap(state.sessionLastActivity, key),
        currentSessionKey: selection.currentSessionKey,
        currentAgentId: selection.currentAgentId,
      };
    });
    return { success: true };
  },

  deleteSessions: async (keys) => {
    const requestedKeys = [...new Set(keys)].filter(Boolean);
    const deletedKeys: string[] = [];
    const failedKeys: string[] = [];

    // Main rewrites each agent's sessions.json, so deletes must stay sequential.
    for (const key of requestedKeys) {
      try {
        const result = await hostApi.sessions.delete(key);
        if (result.success) deletedKeys.push(key);
        else failedKeys.push(key);
      } catch {
        failedKeys.push(key);
      }
    }
    if (deletedKeys.length === 0) return { deletedKeys, failedKeys };

    const deletedSet = new Set(deletedKeys);
    for (const key of deletedKeys) {
      clearSessionLabelHydrationTracking(key);
      localDraftSessionKeys.delete(key);
      useComposerDraftStore.getState().clearDraft(key);
      useSessionAttentionStore.getState().removeSession(key);
      pendingCatalogConfirmationSessionKeys.delete(key);
    }
    markLocalSessionCatalogMutation();
    set((state) => {
      const remaining = state.sessions.filter((session) => !deletedSet.has(session.key));
      const currentWasDeleted = deletedSet.has(state.currentSessionKey);
      const selection = currentWasDeleted
        ? repairMissingCurrentSelection(state.currentSessionKey, remaining)
        : {
            sessions: remaining,
            currentSessionKey: state.currentSessionKey,
            currentAgentId: state.currentAgentId,
          };
      return {
        sessions: selection.sessions,
        sessionLabels: Object.fromEntries(
          Object.entries(state.sessionLabels).filter(([key]) => !deletedSet.has(key)),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(state.sessionLastActivity).filter(([key]) => !deletedSet.has(key)),
        ),
        currentSessionKey: selection.currentSessionKey,
        currentAgentId: selection.currentAgentId,
      };
    });
    return { deletedKeys, failedKeys };
  },

  removeAgentSessions: (agentId) => {
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) return;
    const sessionPrefix = `agent:${normalizedAgentId}:`;
    const belongsToDeletedAgent = (sessionKey: string): boolean => sessionKey.startsWith(sessionPrefix);
    const state = get();
    const composerDrafts = useComposerDraftStore.getState().drafts;
    const attentionKeys = Object.keys(useSessionAttentionStore.getState().bySessionKey);
    const removedKeys = new Set([
      ...state.sessions.map((session) => session.key),
      ...Object.keys(state.sessionLabels),
      ...Object.keys(state.sessionLastActivity),
      ...Object.keys(composerDrafts),
      ...attentionKeys,
      ...localDraftSessionKeys,
      ...pendingCatalogConfirmationSessionKeys,
      state.currentSessionKey,
    ].filter(belongsToDeletedAgent));

    for (const key of removedKeys) {
      clearSessionLabelHydrationTracking(key);
      localDraftSessionKeys.delete(key);
      pendingCatalogConfirmationSessionKeys.delete(key);
      useComposerDraftStore.getState().clearDraft(key);
      useSessionAttentionStore.getState().removeSession(key);
    }

    markLocalSessionCatalogMutation();
    set((current) => {
      const remaining = current.sessions.filter((session) => !belongsToDeletedAgent(session.key));
      const currentWasRemoved = belongsToDeletedAgent(current.currentSessionKey);
      const selection = currentWasRemoved
        ? repairMissingCurrentSelection(DEFAULT_SESSION_KEY, remaining)
        : {
            sessions: remaining,
            currentSessionKey: current.currentSessionKey,
            currentAgentId: current.currentAgentId,
          };
      return {
        sessions: selection.sessions,
        sessionLabels: Object.fromEntries(
          Object.entries(current.sessionLabels).filter(([key]) => !belongsToDeletedAgent(key)),
        ),
        sessionLastActivity: Object.fromEntries(
          Object.entries(current.sessionLastActivity).filter(([key]) => !belongsToDeletedAgent(key)),
        ),
        currentSessionKey: selection.currentSessionKey,
        currentAgentId: selection.currentAgentId,
      };
    });
  },

  renameSession: async (key, label) => {
    const normalized = label.trim();
    if (!normalized) throw new Error('Session label cannot be empty');

    const result = await hostApi.sessions.rename(key, normalized);
    if (!result.success) throw new Error(result.error || 'Failed to rename session');

    const session = get().sessions.find((entry) => entry.key === key);
    if (session) {
      finishSessionLabelHydration(
        key,
        getSessionLabelHydrationVersion(session, get().sessionLastActivity),
        'backend-label',
      );
    }
    markLocalSessionCatalogMutation();
    set((state) => ({
      sessions: state.sessions.map((entry) => (
        entry.key === key ? { ...entry, label: normalized } : entry
      )),
      sessionLabels: { ...state.sessionLabels, [key]: normalized },
    }));
  },
}));
