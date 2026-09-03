/**
 * Chat Page
 * ACP-native runtime rendering through the ordered inline timeline.
 */
import {
  Suspense, lazy, useCallback, useDeferredValue, useEffect,
  useMemo, useRef, useState, type SetStateAction,
} from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowLeft, BotMessageSquare, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DEFAULT_SESSION_KEY } from '@shared/chat/types';
import type { AcpSessionFamilyResult } from '@shared/acp-chat/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore } from '@/stores/chat';
import { useComposerDraftStore } from '@/stores/composer-drafts';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useSettingsStore } from '@/stores/settings';
import { ensureAcpChatSubscriptions, useAcpChatSessionStore } from '@/stores/acp-chat-session';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import {
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
  normalizeWorkspacePath,
  resolveEffectiveWorkspace,
} from '@/lib/workspace-context';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useWorkspaceAvailability } from '@/hooks/use-workspace-availability';
import { getAcpUserMessageAnchorId } from '@/lib/acp/timeline-anchors';
import { getCurrentAcpPlan } from '@/lib/acp/current-plan';
import type { MessageSegmentItem, RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import type { AcpTurnTiming } from '@/lib/acp/turn-timings';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import { projectOpenClawFileActivities, type AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { hostApi } from '@/lib/host-api';
import { getSessionDisplayTitle } from '@shared/chat/session-title';
import { ChatInput, type ChatWorkspaceOption, type FileAttachment } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { AcpTimeline } from './AcpTimeline';
import { AcpErrorBanner } from './AcpErrorBanner';
import { projectSessionRunState } from '@/stores/chat/session-status';
import { formatSubagentSessionTitle, isNativeSubagentSessionKey } from '@/stores/chat/session-key-utils';
import type { AcpSubagentSession } from './AcpSubagentSessions';

const ArtifactPanelLazy = lazy(() =>
  import('@/components/file-preview/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
const PanelResizeDividerLazy = lazy(() =>
  import('@/components/file-preview/PanelResizeDivider').then((m) => ({ default: m.PanelResizeDivider })),
);

const EMPTY_FILE_ACTIVITY: AcpFileActivityProjection = {
  activities: [],
  turnSummariesByTurnId: {},
  fileGroups: [],
  uniqueFileCount: 0,
};

// A session switch remounts Chat before the child catalog row is refreshed.
const activeSubagentSessionKeys = new Set<string>();

type QuestionDirectoryItem = {
  itemId: string;
  anchorId: string;
  title: string;
};

const QUESTION_DIRECTORY_RENDER_LIMIT = 300;

type WorkspaceContextCheck = {
  key: string;
  available: boolean;
};

type LoadedAcpSessionFamily = {
  sessionKey: string;
  result: Extract<AcpSessionFamilyResult, { success: true }>;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function successfulSessionSpawnIdentity(item: ToolCallItem): string | null {
  const toolName = item.title.split(':', 1)[0]?.trim();
  if (toolName !== 'sessions_spawn' || item.status !== 'completed') return null;
  const details = recordValue(recordValue(item.output)?.details);
  if (details?.status !== 'accepted') return null;
  const runId = typeof details.runId === 'string' ? details.runId.trim() : '';
  const childSessionKey = typeof details.childSessionKey === 'string' ? details.childSessionKey.trim() : '';
  return runId && childSessionKey ? `${item.toolCallId}\0${runId}\0${childSessionKey}` : null;
}

function buildQuestionDirectoryTitle(item: MessageSegmentItem, fallback: string): string {
  const markdown = item.parts.find(
    (part): part is Extract<RenderPart, { kind: 'markdown' }> => part.kind === 'markdown' && part.text.trim().length > 0,
  );
  const normalized = markdown?.text.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  const graphemes = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized),
    ({ segment }) => segment,
  );
  return graphemes.length > 64 ? `${graphemes.slice(0, 61).join('')}...` : normalized;
}

function isRecoverableInitialAcpLoadError(message: string | null): boolean {
  return !!message && message.includes("reply was never sent");
}

function QuestionDirectory({ items }: { items: QuestionDirectoryItem[] }) {
  const { t } = useTranslation('chat');
  const navRef = useRef<HTMLElement | null>(null);
  const visibleItems = items.slice(-QUESTION_DIRECTORY_RENDER_LIMIT);
  const hiddenCount = items.length - visibleItems.length;

  useEffect(() => {
    const nav = navRef.current;
    if (nav) nav.scrollTop = nav.scrollHeight;
  }, [items.length]);

  return (
    <aside
      id="chat-question-directory"
      data-testid="chat-question-directory"
      aria-label={t('questionDirectory.title')}
      className="absolute right-0 top-0 z-30 flex max-h-[min(32rem,calc(100%-1rem))] w-[min(18rem,calc(100%-1rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-surface-modal/95 p-3 shadow-xl shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:shadow-black/30"
    >
      <h2 className="px-1 pb-2 text-sm font-medium text-foreground">{t('questionDirectory.title')}</h2>
      <nav
        ref={navRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto"
        aria-label={t('questionDirectory.title')}
      >
        {visibleItems.map((item) => (
          <button
            key={item.itemId}
            type="button"
            data-testid={`chat-question-directory-item-${item.itemId}`}
            title={item.title}
            onClick={() => document.getElementById(item.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
          >
            <span className="block truncate">{item.title}</span>
          </button>
        ))}
      </nav>
      {hiddenCount > 0 && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          {t('questionDirectory.moreHint', { count: hiddenCount })}
        </p>
      )}
    </aside>
  );
}

function AcpEmptyState() {
  const { t } = useTranslation('chat');
  return (
    <div data-testid="acp-chat-empty-state" className="flex h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-4xl font-serif font-normal tracking-tight text-foreground/80 md:text-5xl">
        {t('welcome.subtitle')}
      </h1>
    </div>
  );
}

function WorkspaceUnavailableBanner({
  path,
  readOnly,
  onChooseWorkspace,
}: {
  path: string;
  readOnly: boolean;
  onChooseWorkspace?: () => void;
}) {
  const { t } = useTranslation('chat');
  return (
    <div
      data-testid="workspace-unavailable-banner"
      className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-surface-modal px-4 py-3 text-amber-700 shadow-sm dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('workspace.unavailable.title')}</p>
        <p className="mt-1 break-words text-sm opacity-80">
          {t(readOnly ? 'workspace.unavailable.boundDescription' : 'workspace.unavailable.description', { path })}
        </p>
        {!readOnly && onChooseWorkspace && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 border-amber-500/30 bg-transparent text-amber-700 hover:bg-black/5 dark:text-amber-400 dark:hover:bg-white/10"
            onClick={onChooseWorkspace}
          >
            <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('workspace.unavailable.chooseAction')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Chat() {
  ensureAcpChatSubscriptions();

  const { t } = useTranslation('chat');

  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const composerDraft = useComposerDraftStore((s) => s.drafts[currentSessionKey] ?? '');
  const setComposerDraft = useComposerDraftStore((s) => s.setDraft);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const switchSession = useChatStore((s) => s.switchSession);
  const selectAcpSession = useChatStore((s) => s.selectAcpSession);
  const acknowledgeAcpSessionCreated = useChatStore((s) => s.acknowledgeAcpSessionCreated);
  const setVisibleSession = useSessionAttentionStore((s) => s.setVisibleSession);
  const sessionAttentionByKey = useSessionAttentionStore((s) => s.bySessionKey);
  const markSessionRead = useSessionAttentionStore((s) => s.markRead);
  const chatWorkspacePath = useSettingsStore((s) => s.chatWorkspacePath);
  const recentWorkspacePaths = useSettingsStore((s) => s.recentWorkspacePaths ?? []);
  const workspaceLabels = useSettingsStore((s) => s.workspaceLabels);
  const setChatWorkspacePath = useSettingsStore((s) => s.setChatWorkspacePath);
  const removeWorkspace = useSettingsStore((s) => s.removeWorkspace);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);
  const [sessionDiscoveryAttempted, setSessionDiscoveryAttempted] = useState(false);
  const [lastPromptAttemptSessionKey, setLastPromptAttemptSessionKey] = useState<string | null>(null);
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);
  const [resolvedWorkspaceContext, setResolvedWorkspaceContext] = useState<{
    key: string;
    sessionKey: string;
    workspaceRoot: string;
    executionCwd: string;
  } | null>(null);
  const [workspaceContextCheck, setWorkspaceContextCheck] = useState<WorkspaceContextCheck | null>(null);
  const [loadedSessionFamily, setLoadedSessionFamily] = useState<LoadedAcpSessionFamily | null>(null);
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  );
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const catalogSessionTitle = currentSession?.createdLocally
    ? t('newSession')
    : currentSession
      ? getSessionDisplayTitle(currentSession, sessionLabels)
      : currentSessionKey;
  const effectiveWorkspace = useMemo(
    () => resolveEffectiveWorkspace({
      session: currentSession,
      globalWorkspace: chatWorkspacePath,
      defaultWorkspace: currentSessionKey === DEFAULT_SESSION_KEY
        ? currentAgent?.workspace
        : undefined,
    }),
    [chatWorkspacePath, currentAgent?.workspace, currentSession, currentSessionKey],
  );
  const cwd = effectiveWorkspace.cwd;
  const allWorkspacePaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    const candidatePaths = [
      ...recentWorkspacePaths,
      chatWorkspacePath,
      ...sessions.map((session) => session.workspacePath).filter((path): path is string => !!path),
    ];
    for (const path of candidatePaths) {
      const normalized = normalizeWorkspacePath(path);
      if (!normalized || isDefaultWorkspacePath(normalized)) continue;
      const slashedPath = normalized.replace(/\\/g, '/');
      const identity = /^[A-Za-z]:\//.test(slashedPath) ? slashedPath.toLowerCase() : slashedPath;
      if (seen.has(identity)) continue;
      seen.add(identity);
      paths.push(normalized);
    }
    return paths;
  }, [chatWorkspacePath, recentWorkspacePaths, sessions]);
  const unreferencedRecentWorkspacePaths = useMemo(() => {
    if (agents.length === 0) return [];
    const referencedPaths = new Set(
      [
        chatWorkspacePath,
        ...agents.map((agent) => agent.workspace),
        ...sessions.map((session) => session.workspacePath).filter((path): path is string => !!path),
      ]
        .map((path) => normalizeWorkspacePath(path))
        .filter((path): path is string => Boolean(path)),
    );
    return recentWorkspacePaths.filter((path) => {
      const normalized = normalizeWorkspacePath(path);
      return Boolean(
        normalized
        && !isDefaultWorkspacePath(normalized)
        && !referencedPaths.has(normalized),
      );
    });
  }, [agents, chatWorkspacePath, recentWorkspacePaths, sessions]);
  const unreferencedWorkspaceAvailability = useWorkspaceAvailability(unreferencedRecentWorkspacePaths);

  useEffect(() => {
    const unavailablePaths = unreferencedRecentWorkspacePaths.filter(
      (path) => unreferencedWorkspaceAvailability[path] === 'unavailable',
    );
    if (unavailablePaths.length === 0) return;
    void removeWorkspace(unavailablePaths[0]!, unavailablePaths.slice(1)).catch((error) => {
      console.warn('[chat] Failed to prune unavailable recent workspaces:', error);
    });
  }, [removeWorkspace, unreferencedRecentWorkspacePaths, unreferencedWorkspaceAvailability]);

  const workspaceLabel = getWorkspaceDisplayLabel(
    cwd,
    t('workspace.defaultLabel'),
    workspaceLabels,
    allWorkspacePaths,
  );
  const workspaceOptions = useMemo<ChatWorkspaceOption[]>(() => {
    return allWorkspacePaths.map((normalized) => ({
      path: normalized,
      label: getWorkspaceDisplayLabel(
        normalized,
        t('workspace.defaultLabel'),
        workspaceLabels,
        allWorkspacePaths,
      ),
    }));
  }, [allWorkspacePaths, t, workspaceLabels]);
  const acpTimeline = useAcpChatSessionStore((s) => s.timeline);
  const acpActiveSessionKey = useAcpChatSessionStore((s) => s.activeSessionKey);
  const renderedAcpTimeline = useDeferredValue(acpTimeline);
  const emptyCurrentTimeline = useMemo(
    () => createEmptyAcpTimeline(currentSessionKey ?? '', 0),
    [currentSessionKey],
  );
  const visibleAcpTimeline = acpActiveSessionKey === currentSessionKey
    ? renderedAcpTimeline
    : acpTimeline.sessionId === currentSessionKey
      ? acpTimeline
      : emptyCurrentTimeline;
  const acpTurnTimings = useAcpChatSessionStore((s) => s.turnTimingsByUserMessageId);
  const acpLoading = useAcpChatSessionStore((s) => s.loading);
  const acpSending = useAcpChatSessionStore((s) => s.sending);
  const imageGenerationPending = useAcpChatSessionStore(
    (s) => Boolean(s.pendingImageGenerationTaskIds?.length),
  );
  const acpCancelling = useAcpChatSessionStore((s) => s.cancelling);
  const acpError = useAcpChatSessionStore((s) => s.error);
  const acpWorkspaceRoot = useAcpChatSessionStore((s) => s.workspaceRoot);
  const acpCwd = useAcpChatSessionStore((s) => s.cwd);
  const prepareLocalAcpSession = useAcpChatSessionStore((s) => s.prepareLocalSession);
  const loadAcpSession = useAcpChatSessionStore((s) => s.loadSession);
  const sendAcpPrompt = useAcpChatSessionStore((s) => s.sendPrompt);
  const cancelAcp = useAcpChatSessionStore((s) => s.cancel);
  const respondAcpPermission = useAcpChatSessionStore((s) => s.respondPermission);
  const clearAcpError = useAcpChatSessionStore((s) => s.clearError);
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const closeArtifactPanel = useArtifactPanel((s) => s.close);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const acpLoadInFlightKeyRef = useRef<string | null>(null);
  const familyRequestIdRef = useRef(0);
  const selectedFamilySessionKeyRef = useRef(currentSessionKey);
  const spawnInvalidationRef = useRef({ sessionKey: '', signature: '' });
  const { contentRef, scrollRef, scrollToBottom, isAtBottom } = useStickToBottomInstant(
    currentSessionKey,
    acpSending || acpCancelling,
  );
  selectedFamilySessionKeyRef.current = currentSessionKey;

  const loadCurrentSessionFamily = useCallback((sessionKey: string) => {
    const requestId = ++familyRequestIdRef.current;
    void hostApi.chat.getAcpSessionFamily({ sessionKey }).then((result) => {
      if (
        requestId !== familyRequestIdRef.current
        || selectedFamilySessionKeyRef.current !== sessionKey
        || !result.success
      ) return;
      setLoadedSessionFamily({ sessionKey, result });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    familyRequestIdRef.current += 1;
    setLoadedSessionFamily((current) => current?.sessionKey === currentSessionKey ? current : null);
    if (currentSessionKey) loadCurrentSessionFamily(currentSessionKey);
    return () => {
      familyRequestIdRef.current += 1;
    };
  }, [currentSessionKey, loadCurrentSessionFamily]);

  useEffect(() => {
    setVisibleSession(currentSessionKey);
    return () => setVisibleSession(null);
  }, [currentSessionKey, setVisibleSession]);

  useEffect(() => {
    void fetchAgents().catch(() => undefined);
  }, [fetchAgents]);

  useEffect(() => {
    closeArtifactPanel();
  }, [currentSessionKey, closeArtifactPanel]);

  const projectionExecutionCwd = acpActiveSessionKey === currentSessionKey && acpCwd ? acpCwd : cwd;
  const workspaceContextKey = currentSessionKey && cwd && projectionExecutionCwd
    ? `${currentSessionKey}\0${cwd}\0${projectionExecutionCwd}`
    : null;

  useEffect(() => {
    if (!workspaceContextKey || !currentSessionKey || !cwd || !projectionExecutionCwd) return;
    let stale = false;
    setWorkspaceContextCheck(null);
    void hostApi.files.resolveWorkspaceContext({
      workspaceRoot: cwd,
      executionCwd: projectionExecutionCwd,
    }).then((result) => {
      if (stale) return;
      if (!result.ok || !result.workspaceRoot || !result.executionCwd) {
        setResolvedWorkspaceContext(null);
        setWorkspaceContextCheck({ key: workspaceContextKey, available: false });
        return;
      }
      setResolvedWorkspaceContext({
        key: workspaceContextKey,
        sessionKey: currentSessionKey,
        workspaceRoot: result.workspaceRoot,
        executionCwd: result.executionCwd,
      });
      setWorkspaceContextCheck({ key: workspaceContextKey, available: true });
    }).catch(() => {
      if (stale) return;
      setResolvedWorkspaceContext(null);
      setWorkspaceContextCheck({ key: workspaceContextKey, available: false });
    });
    return () => {
      stale = true;
    };
  }, [currentSessionKey, cwd, projectionExecutionCwd, workspaceContextKey]);

  const workspaceContextAvailable = !!workspaceContextKey
    && workspaceContextCheck?.key === workspaceContextKey
    && workspaceContextCheck.available;
  const workspaceUnavailable = !!workspaceContextKey
    && workspaceContextCheck?.key === workspaceContextKey
    && !workspaceContextCheck.available;

  useEffect(() => {
    if (currentSessionKey !== DEFAULT_SESSION_KEY || sessions.length > 0 || sessionDiscoveryAttempted) return;
    let cancelled = false;
    void loadSessions()
      .finally(() => {
        if (!cancelled) setSessionDiscoveryAttempted(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentSessionKey, loadSessions, sessionDiscoveryAttempted, sessions.length]);

  useEffect(() => {
    if (!currentSessionKey || !cwd || !currentSession?.createdLocally) return;
    acpLoadInFlightKeyRef.current = null;
    const hasStaleTimeline = acpTimeline.sessionId !== currentSessionKey || acpTimeline.itemOrder.length > 0;
    if (acpActiveSessionKey === currentSessionKey && acpWorkspaceRoot === cwd && acpCwd === cwd && !hasStaleTimeline) return;
    prepareLocalAcpSession({ sessionKey: currentSessionKey, workspaceRoot: cwd, cwd });
  }, [acpActiveSessionKey, acpCwd, acpTimeline.itemOrder.length, acpTimeline.sessionId, acpWorkspaceRoot, currentSession, currentSessionKey, cwd, prepareLocalAcpSession]);

  useEffect(() => {
    if (!currentSessionKey || !cwd || !workspaceContextAvailable) return;
    if (currentSessionKey === DEFAULT_SESSION_KEY && sessions.length === 0 && acpActiveSessionKey == null && !sessionDiscoveryAttempted) return;
    if (acpActiveSessionKey === currentSessionKey && acpWorkspaceRoot === cwd && acpCwd === cwd) return;
    const acpLoadKey = `${currentSessionKey}\0${cwd}`;
    if (acpLoadInFlightKeyRef.current === acpLoadKey) return;
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    if (currentSession?.createdLocally) return;
    const createIfMissing = !currentSession;
    acpLoadInFlightKeyRef.current = acpLoadKey;
    if (createIfMissing) selectAcpSession(currentSessionKey, cwd);
    void loadAcpSession({
      sessionKey: currentSessionKey,
      workspaceRoot: cwd,
      cwd,
      ...(createIfMissing ? { createIfMissing: true } : {}),
    }).then((loaded) => {
      if (loaded && createIfMissing) {
        acknowledgeAcpSessionCreated(currentSessionKey, cwd);
      }
    }).finally(() => {
      if (acpLoadInFlightKeyRef.current === acpLoadKey) {
        acpLoadInFlightKeyRef.current = null;
      }
    });
  }, [acknowledgeAcpSessionCreated, acpActiveSessionKey, acpCwd, acpWorkspaceRoot, currentSessionKey, cwd, loadAcpSession, selectAcpSession, sessionDiscoveryAttempted, sessions, workspaceContextAvailable]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const showScrollToLatest = visibleAcpTimeline.itemOrder.length > 0 && !isAtBottom;
  const hasAttemptedAcpPromptForCurrentSession = lastPromptAttemptSessionKey === currentSessionKey;
  const visibleAcpError = !workspaceUnavailable && acpError
    && !(acpTimeline.itemOrder.length === 0 && !hasAttemptedAcpPromptForCurrentSession && isRecoverableInitialAcpLoadError(acpError))
    ? acpError
    : null;
  const chooseReplacementWorkspace = async () => {
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) setChatWorkspacePath(selected);
    } catch {
      toast.error(t('composer.workspacePickerFailed'));
    }
  };
  const fileActivity = useMemo(() => {
    if (
      !workspaceContextKey
      || resolvedWorkspaceContext?.key !== workspaceContextKey
      || resolvedWorkspaceContext.sessionKey !== currentSessionKey
      || acpActiveSessionKey !== currentSessionKey
      || visibleAcpTimeline.sessionId !== currentSessionKey
    ) return EMPTY_FILE_ACTIVITY;
    return projectOpenClawFileActivities({
      timeline: visibleAcpTimeline,
      workspaceRoot: resolvedWorkspaceContext.workspaceRoot,
      executionCwd: resolvedWorkspaceContext.executionCwd,
    });
  }, [acpActiveSessionKey, currentSessionKey, resolvedWorkspaceContext, visibleAcpTimeline, workspaceContextKey]);
  const questionDirectoryItems = useMemo(() => {
    const userItems = visibleAcpTimeline.itemOrder
      .map((itemId) => visibleAcpTimeline.itemsById[itemId])
      .filter((item): item is MessageSegmentItem => item?.kind === 'message-segment' && item.role === 'user');
    return userItems.map((item, index) => ({
      itemId: item.id,
      anchorId: getAcpUserMessageAnchorId(item.id),
      title: buildQuestionDirectoryTitle(item, t('questionDirectory.fallback', { number: index + 1 })),
    }));
  }, [t, visibleAcpTimeline]);
  const questionDirectoryVisible = questionDirectoryOpenSessionKey === currentSessionKey
    && questionDirectoryItems.length > 1;
  const composerContextUsage = visibleAcpTimeline.metadata.usage;
  const currentPlan = useMemo(
    () => visibleAcpTimeline.sessionId === currentSessionKey
      ? getCurrentAcpPlan(visibleAcpTimeline)
      : null,
    [currentSessionKey, visibleAcpTimeline],
  );
  const successfulSpawnSignature = useMemo(() => {
    if (visibleAcpTimeline.sessionId !== currentSessionKey) return '';
    return visibleAcpTimeline.itemOrder
      .map((itemId) => visibleAcpTimeline.itemsById[itemId])
      .filter((item): item is ToolCallItem => item?.kind === 'tool-call')
      .map(successfulSessionSpawnIdentity)
      .filter((identity): identity is string => identity !== null)
      .join('\n');
  }, [currentSessionKey, visibleAcpTimeline]);
  useEffect(() => {
    const previous = spawnInvalidationRef.current;
    if (previous.sessionKey !== currentSessionKey) {
      spawnInvalidationRef.current = { sessionKey: currentSessionKey, signature: successfulSpawnSignature };
      return;
    }
    if (previous.signature === successfulSpawnSignature) return;
    spawnInvalidationRef.current = { sessionKey: currentSessionKey, signature: successfulSpawnSignature };
    if (successfulSpawnSignature) loadCurrentSessionFamily(currentSessionKey);
  }, [currentSessionKey, loadCurrentSessionFamily, successfulSpawnSignature]);
  const visibleSessionFamily = loadedSessionFamily?.sessionKey === currentSessionKey
    ? loadedSessionFamily.result
    : null;
  const catalogSessionByKey = useMemo(
    () => new Map(sessions.map((session) => [session.key, session])),
    [sessions],
  );
  const currentCatalogSession = catalogSessionByKey.get(currentSessionKey);
  const currentSessionRunState = currentCatalogSession
    ? projectSessionRunState(currentCatalogSession)
    : 'unknown';
  const subagentSessions = useMemo<AcpSubagentSession[]>(() => {
    if (!visibleSessionFamily) return [];
    return visibleSessionFamily.children.flatMap((child) => {
      const catalogSession = catalogSessionByKey.get(child.sessionKey);
      if (!catalogSession) return [];
      const runState = catalogSession ? projectSessionRunState(catalogSession) : 'unknown';
      return [{
        sessionKey: child.sessionKey,
        title: child.title,
        busy: runState === 'busy'
          || (runState === 'unknown' && sessionAttentionByKey[child.sessionKey]?.observedBusy === true),
      }];
    });
  }, [catalogSessionByKey, sessionAttentionByKey, visibleSessionFamily]);
  useEffect(() => {
    for (const session of subagentSessions) {
      if (!session.busy) activeSubagentSessionKeys.delete(session.sessionKey);
    }
    if (currentSessionRunState === 'idle') {
      activeSubagentSessionKeys.delete(currentSessionKey);
    }
  }, [currentSessionKey, currentSessionRunState, subagentSessions]);
  const isCurrentSessionSubagent = visibleSessionFamily?.current?.sessionKey === currentSessionKey
    && isNativeSubagentSessionKey(currentSessionKey);
  const currentSessionTitle = isNativeSubagentSessionKey(currentSessionKey)
    ? isCurrentSessionSubagent
      ? formatSubagentSessionTitle(currentSessionKey, visibleSessionFamily.current!.title)
      : currentSessionKey
    : catalogSessionTitle;
  const familyParentSessionKey = isCurrentSessionSubagent
    ? visibleSessionFamily.current?.parentSessionKey
    : null;
  const directParentSessionKey = familyParentSessionKey && catalogSessionByKey.has(familyParentSessionKey)
    ? familyParentSessionKey
    : null;
  const currentSubagentBusy = isCurrentSessionSubagent && (
    currentSessionRunState === 'busy'
    || (currentSessionRunState === 'unknown' && (
      sessionAttentionByKey[currentSessionKey]?.observedBusy === true
      || activeSubagentSessionKeys.has(currentSessionKey)
    ))
  );
  const completedSubagentTurn = useMemo(() => {
    if (!currentSubagentBusy) return null;
    for (let index = visibleAcpTimeline.itemOrder.length - 1; index >= 0; index -= 1) {
      const item = visibleAcpTimeline.itemsById[visibleAcpTimeline.itemOrder[index]];
      if (item?.kind !== 'message-segment' || item.role !== 'user') continue;
      const timing = acpTurnTimings[item.messageId];
      if (timing?.status === 'complete') {
        return { messageId: item.messageId, durationMs: timing.durationMs };
      }
    }
    return null;
  }, [acpTurnTimings, currentSubagentBusy, visibleAcpTimeline]);
  const [liveSubagentTurn, setLiveSubagentTurn] = useState<{
    sessionKey: string;
    messageId: string;
    startedAtMs: number;
  } | null>(null);
  useEffect(() => {
    if (!completedSubagentTurn) {
      setLiveSubagentTurn((current) => (
        current?.sessionKey === currentSessionKey ? null : current
      ));
      return;
    }
    setLiveSubagentTurn((current) => (
      current?.sessionKey === currentSessionKey && current.messageId === completedSubagentTurn.messageId
        ? current
        : {
            sessionKey: currentSessionKey,
            messageId: completedSubagentTurn.messageId,
            startedAtMs: Date.now() - completedSubagentTurn.durationMs,
          }
    ));
  }, [completedSubagentTurn, currentSessionKey]);
  const visibleTurnTimings = useMemo(() => {
    if (liveSubagentTurn?.sessionKey !== currentSessionKey) return acpTurnTimings;
    return {
      ...acpTurnTimings,
      [liveSubagentTurn.messageId]: {
        source: 'live',
        status: 'running',
        startedAtMs: liveSubagentTurn.startedAtMs,
      } satisfies AcpTurnTiming,
    };
  }, [acpTurnTimings, currentSessionKey, liveSubagentTurn]);
  const navigateToSession = useCallback((sessionKey: string) => {
    if (!useChatStore.getState().sessions.some((session) => session.key === sessionKey)) return;
    markSessionRead(sessionKey);
    if (sessionKey !== currentSessionKey) switchSession(sessionKey);
  }, [currentSessionKey, markSessionRead, switchSession]);
  const selectSubagentSession = useCallback((sessionKey: string) => {
    if (
      projectSessionRunState(catalogSessionByKey.get(sessionKey) ?? {}) === 'busy'
      || sessionAttentionByKey[sessionKey]?.observedBusy === true
    ) {
      activeSubagentSessionKeys.add(sessionKey);
    }
    navigateToSession(sessionKey);
  }, [catalogSessionByKey, navigateToSession, sessionAttentionByKey]);
  const handleComposerDraftChange = useCallback((update: SetStateAction<string>) => {
    setComposerDraft(currentSessionKey, update);
  }, [currentSessionKey, setComposerDraft]);

  return (
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 -m-6 overflow-hidden transition-colors duration-500',
        'bg-background',
        isMac && 'z-20 rounded-tl-2xl shadow-[inset_1px_1px_0_hsl(var(--border)/0.55)]',
        isWindows && 'rounded-tl-2xl',
      )}
      style={{ height: isMac ? 'calc(100vh - 1px)' : 'calc(100vh - 2.5rem)' }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className={cn(
          'relative flex shrink-0 items-center px-4 py-2',
          isWindows ? 'gap-4' : 'justify-end',
        )}>
          <div data-testid="chat-toolbar-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden="true" />
          {(isWindows || isCurrentSessionSubagent) && (
            <div className={cn(
              'relative z-10 flex min-w-0 flex-1 items-center gap-2',
              isWindows ? 'drag-region' : 'no-drag',
            )}>
              {isWindows && (
                <h1
                  data-testid="chat-session-title"
                  title={currentSessionTitle}
                  className="min-w-0 truncate text-sm font-medium text-foreground"
                >
                  {currentSessionTitle}
                </h1>
              )}
              {isCurrentSessionSubagent && (
                <>
                  <Badge
                    variant="secondary"
                    data-testid="chat-subagent-marker"
                    className="no-drag shrink-0 gap-1 px-1.5 py-0.5 text-2xs font-medium"
                  >
                    <BotMessageSquare aria-hidden="true" className="h-3 w-3" />
                    {t('acp.subagentSessions.marker')}
                  </Badge>
                  {directParentSessionKey && (
                    <button
                      type="button"
                      onClick={() => navigateToSession(directParentSessionKey)}
                      aria-label={t('acp.subagentSessions.returnToParent')}
                      className="no-drag inline-flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
                    >
                      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t('acp.subagentSessions.returnToParent')}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <div data-testid="chat-toolbar-actions" className="no-drag relative z-10">
            <ChatToolbar
              questionDirectoryOpen={questionDirectoryVisible}
              questionDirectoryCount={questionDirectoryItems.length}
              onToggleQuestionDirectory={() => setQuestionDirectoryOpenSessionKey((openSessionKey) => (
                openSessionKey === currentSessionKey ? null : currentSessionKey
              ))}
              workspaceAvailable={!!cwd}
            />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
            <div data-testid="chat-scroll-column" className="relative min-h-0 min-w-0 flex-1">
              <div ref={scrollRef} className="h-full min-h-0 min-w-0 overflow-y-auto" data-testid="chat-scroll-container">
                <div ref={contentRef} className="mx-auto max-w-4xl space-y-4">
                  {workspaceUnavailable && (
                    <WorkspaceUnavailableBanner
                      path={cwd}
                      readOnly={effectiveWorkspace.readOnly}
                      onChooseWorkspace={effectiveWorkspace.readOnly ? undefined : () => void chooseReplacementWorkspace()}
                    />
                  )}
                  {visibleAcpError && <AcpErrorBanner message={visibleAcpError} onDismiss={clearAcpError} />}
                  {acpLoading ? (
                    <div className="flex min-h-[40vh] items-center justify-center" data-testid="acp-chat-loading">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : visibleAcpTimeline.itemOrder.length === 0 ? (
                    <AcpEmptyState />
                  ) : (
                    <AcpTimeline
                      snapshot={visibleAcpTimeline}
                      isStreaming={acpSending || acpCancelling || currentSubagentBusy}
                      turnTimingsByUserMessageId={visibleTurnTimings}
                      fileActivity={fileActivity}
                      workspaceRoot={resolvedWorkspaceContext?.key === workspaceContextKey
                        ? resolvedWorkspaceContext.workspaceRoot
                        : undefined}
                      onPermissionSelect={(requestId, optionId) => {
                        void respondAcpPermission(requestId, optionId);
                      }}
                    />
                  )}
                </div>
              </div>

              {showScrollToLatest && (
                <button
                  type="button"
                  onClick={() => void scrollToBottom({ animation: 'smooth', ignoreEscapes: true })}
                  className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10 dark:shadow-black/30"
                  aria-label={t('scrollToLatest')}
                  title={t('scrollToLatest')}
                  data-testid="chat-scroll-to-latest"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  <span>{t('scrollToLatest')}</span>
                </button>
              )}
            </div>

            {questionDirectoryVisible && <QuestionDirectory items={questionDirectoryItems} />}
          </div>
        </div>

        {(!isCurrentSessionSubagent || currentSubagentBusy) && <ChatInput
          draft={composerDraft}
          draftKey={currentSessionKey}
          onDraftChange={handleComposerDraftChange}
          onSend={(text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
            if (!currentSessionKey || !cwd || !workspaceContextAvailable) return;
            const targetAgent = targetAgentId
              ? agents.find((agent) => agent.id === targetAgentId) ?? null
              : null;
            const sessionKey = targetAgent
              ? targetAgent.mainSessionKey || `agent:${targetAgent.id}:main`
              : currentSessionKey;
            const existingSession = sessions.find((session) => session.key === sessionKey);
            setLastPromptAttemptSessionKey(sessionKey);
            const promptCwd = targetAgent?.workspace || cwd;
            const media = attachments
              ?.filter((file) => file.status === 'ready')
              .map((file) => ({
                filePath: file.stagedPath,
                stagingId: file.id,
                fileName: file.fileName,
                mimeType: file.mimeType,
              }));
            if (targetAgent || !existingSession) {
              selectAcpSession(sessionKey, promptCwd);
            }
            void (async () => {
              if (promptCwd !== cwd) {
                const promptWorkspace = await hostApi.files.resolveWorkspaceContext({
                  workspaceRoot: promptCwd,
                  executionCwd: promptCwd,
                }).catch(() => ({ ok: false }));
                if (!promptWorkspace.ok) return;
              }
              const createIfMissing = !existingSession || !!existingSession.createdLocally;
              if (
                createIfMissing
                || acpActiveSessionKey !== sessionKey
                || acpWorkspaceRoot !== promptCwd
                || acpCwd !== promptCwd
              ) {
                const acpLoadKey = `${sessionKey}\0${promptCwd}`;
                acpLoadInFlightKeyRef.current = acpLoadKey;
                const loaded = await (async () => {
                  try {
                    return await loadAcpSession({
                      sessionKey,
                      workspaceRoot: promptCwd,
                      cwd: promptCwd,
                      ...(createIfMissing ? { createIfMissing: true } : {}),
                    });
                  } finally {
                    if (acpLoadInFlightKeyRef.current === acpLoadKey) {
                      acpLoadInFlightKeyRef.current = null;
                    }
                  }
                })();
                if (loaded && createIfMissing) {
                  acknowledgeAcpSessionCreated(sessionKey, promptCwd, text);
                }
                if (!loaded) return;
              }
              const sendPromise = sendAcpPrompt({
                sessionKey,
                cwd: promptCwd,
                message: text,
                media,
              });
              requestAnimationFrame(() => {
                void scrollToBottom({ animation: 'instant', ignoreEscapes: true });
              });
              await sendPromise;
            })();
          }}
          onStop={() => void cancelAcp()}
          disabled={acpLoading || acpCancelling || !cwd || !workspaceContextAvailable}
          sending={isCurrentSessionSubagent ? currentSubagentBusy : acpSending || acpCancelling}
          statusOnly={isCurrentSessionSubagent}
          imageGenerating={imageGenerationPending}
          workspaceLabel={workspaceLabel}
          workspacePath={cwd}
          workspaceOptions={workspaceOptions}
          workspaceReadOnly={effectiveWorkspace.readOnly}
          onSelectWorkspace={setChatWorkspacePath}
          contextUsage={composerContextUsage}
          currentPlan={currentPlan}
          subagentSessions={subagentSessions}
          onSelectSubagent={selectSubagentSession}
        />}
      </div>

      {panelOpen && (
        <>
          <Suspense fallback={null}>
            <PanelResizeDividerLazy containerRef={splitContainerRef} />
          </Suspense>
          <aside
            data-testid="artifact-panel-aside"
            className={cn(
              'relative z-20 hidden shrink-0 border-l border-black/5 dark:border-white/10 lg:flex lg:flex-col',
              isMac && 'no-drag',
            )}
            style={{ width: `${panelWidthPct}%` }}
          >
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center">
                  <LoadingSpinner size="md" />
                </div>
              )}
            >
              <ArtifactPanelLazy
                fileGroups={fileActivity.fileGroups}
                uniqueFileCount={fileActivity.uniqueFileCount}
                agent={currentAgent}
                workspacePath={cwd}
                workspaceLabel={workspaceLabel}
                runStartedAt={null}
              />
            </Suspense>
          </aside>
        </>
      )}
    </div>
  );
}

export default Chat;
