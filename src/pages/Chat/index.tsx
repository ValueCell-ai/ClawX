/**
 * Chat Page
 * ACP-native runtime rendering. The legacy Gateway execution graph remains in
 * the codebase but is no longer part of the primary Chat render path.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SESSION_KEY } from '@shared/chat/types';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { ensureAcpChatSubscriptions, useAcpChatSessionStore } from '@/stores/acp-chat-session';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { getWorkspaceDisplayLabel, resolveEffectiveWorkspace } from '@/lib/workspace-context';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { getAcpUserMessageAnchorId } from '@/lib/acp/timeline-anchors';
import type { MessageSegmentItem, RenderPart } from '@/lib/acp/timeline-types';
import { projectOpenClawFileActivities, type AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { hostApi } from '@/lib/host-api';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { AcpTimeline } from './AcpTimeline';
import { AcpErrorBanner } from './AcpErrorBanner';

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

type QuestionDirectoryItem = {
  itemId: string;
  anchorId: string;
  title: string;
};

const QUESTION_DIRECTORY_RENDER_LIMIT = 300;

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
      className="flex max-h-[40vh] w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-black/10 bg-surface-input p-3 dark:border-white/10 lg:max-h-none lg:w-64 xl:w-72"
    >
      <h2 className="px-1 pb-2 text-sm font-medium text-foreground">{t('questionDirectory.title')}</h2>
      <nav
        ref={navRef}
        className="min-h-0 max-h-[calc(40vh-5rem)] flex-1 space-y-1 overflow-y-auto lg:max-h-[calc(100vh-13rem)]"
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

export function Chat() {
  ensureAcpChatSubscriptions();

  const { t } = useTranslation('chat');

  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const selectAcpSession = useChatStore((s) => s.selectAcpSession);
  const acknowledgeAcpSessionCreated = useChatStore((s) => s.acknowledgeAcpSessionCreated);
  const chatWorkspacePath = useSettingsStore((s) => s.chatWorkspacePath);
  const setChatWorkspacePath = useSettingsStore((s) => s.setChatWorkspacePath);
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
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  );
  const effectiveWorkspace = useMemo(
    () => resolveEffectiveWorkspace({ session: currentSession, globalWorkspace: chatWorkspacePath }),
    [chatWorkspacePath, currentSession],
  );
  const cwd = effectiveWorkspace.cwd;
  const workspaceLabel = getWorkspaceDisplayLabel(cwd, t('workspace.defaultLabel'));
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  const acpTimeline = useAcpChatSessionStore((s) => s.timeline);
  const acpLoading = useAcpChatSessionStore((s) => s.loading);
  const acpSending = useAcpChatSessionStore((s) => s.sending);
  const acpCancelling = useAcpChatSessionStore((s) => s.cancelling);
  const acpError = useAcpChatSessionStore((s) => s.error);
  const acpActiveSessionKey = useAcpChatSessionStore((s) => s.activeSessionKey);
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
  const { contentRef, scrollRef, scrollToBottom, isAtBottom } = useStickToBottomInstant(
    currentSessionKey,
    acpSending || acpCancelling,
  );

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
    void hostApi.files.resolveWorkspaceContext({
      workspaceRoot: cwd,
      executionCwd: projectionExecutionCwd,
    }).then((result) => {
      if (stale || !result.ok || !result.workspaceRoot || !result.executionCwd) return;
      setResolvedWorkspaceContext({
        key: workspaceContextKey,
        sessionKey: currentSessionKey,
        workspaceRoot: result.workspaceRoot,
        executionCwd: result.executionCwd,
      });
    }).catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [currentSessionKey, cwd, projectionExecutionCwd, workspaceContextKey]);

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
    if (!currentSessionKey || !cwd) return;
    if (currentSessionKey === DEFAULT_SESSION_KEY && sessions.length === 0 && acpActiveSessionKey == null && !sessionDiscoveryAttempted) return;
    if (acpActiveSessionKey === currentSessionKey && acpWorkspaceRoot === cwd && acpCwd === cwd) return;
    const acpLoadKey = `${currentSessionKey}\0${cwd}`;
    if (acpLoadInFlightKeyRef.current === acpLoadKey) return;
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    if (currentSession?.createdLocally) return;
    const createIfMissing = !currentSession;
    acpLoadInFlightKeyRef.current = acpLoadKey;
    void loadAcpSession({
      sessionKey: currentSessionKey,
      workspaceRoot: cwd,
      cwd,
      ...(createIfMissing ? { createIfMissing: true } : {}),
    }).then((loaded) => {
      if (loaded && createIfMissing) {
        acknowledgeAcpSessionCreated(currentSessionKey);
      }
    }).finally(() => {
      if (acpLoadInFlightKeyRef.current === acpLoadKey) {
        acpLoadInFlightKeyRef.current = null;
      }
    });
  }, [acknowledgeAcpSessionCreated, acpActiveSessionKey, acpCwd, acpWorkspaceRoot, currentSessionKey, cwd, loadAcpSession, sessionDiscoveryAttempted, sessions]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const composerBusy = acpSending || acpCancelling;
  const showScrollToLatest = acpTimeline.itemOrder.length > 0 && !isAtBottom;
  const hasAttemptedAcpPromptForCurrentSession = lastPromptAttemptSessionKey === currentSessionKey;
  const visibleAcpError = acpError
    && !(acpTimeline.itemOrder.length === 0 && !hasAttemptedAcpPromptForCurrentSession && isRecoverableInitialAcpLoadError(acpError))
    ? acpError
    : null;
  const fileActivity = useMemo(() => {
    if (
      !workspaceContextKey
      || resolvedWorkspaceContext?.key !== workspaceContextKey
      || resolvedWorkspaceContext.sessionKey !== currentSessionKey
      || acpActiveSessionKey !== currentSessionKey
      || acpTimeline.sessionId !== currentSessionKey
    ) return EMPTY_FILE_ACTIVITY;
    return projectOpenClawFileActivities({
      timeline: acpTimeline,
      workspaceRoot: resolvedWorkspaceContext.workspaceRoot,
      executionCwd: resolvedWorkspaceContext.executionCwd,
    });
  }, [acpActiveSessionKey, acpTimeline, currentSessionKey, resolvedWorkspaceContext, workspaceContextKey]);
  const questionDirectoryItems = useMemo(() => {
    const userItems = acpTimeline.itemOrder
      .map((itemId) => acpTimeline.itemsById[itemId])
      .filter((item): item is MessageSegmentItem => item?.kind === 'message-segment' && item.role === 'user');
    return userItems.map((item, index) => ({
      itemId: item.id,
      anchorId: getAcpUserMessageAnchorId(item.id),
      title: buildQuestionDirectoryTitle(item, t('questionDirectory.fallback', { number: index + 1 })),
    }));
  }, [acpTimeline, t]);
  const questionDirectoryVisible = questionDirectoryOpenSessionKey === currentSessionKey
    && questionDirectoryItems.length > 1;

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
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex shrink-0 items-center justify-end px-4 py-2">
          <div data-testid="chat-toolbar-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden="true" />
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
          <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-stretch">
            <div data-testid="chat-scroll-column" className="relative min-h-0 min-w-0 flex-1">
              <div ref={scrollRef} className="h-full min-h-0 min-w-0 overflow-y-auto" data-testid="chat-scroll-container">
                <div ref={contentRef} className="mx-auto max-w-4xl space-y-4">
                  {visibleAcpError && <AcpErrorBanner message={visibleAcpError} onDismiss={clearAcpError} />}
                  {acpLoading ? (
                    <div className="flex min-h-[40vh] items-center justify-center" data-testid="acp-chat-loading">
                      <LoadingSpinner size="md" />
                    </div>
                  ) : acpTimeline.itemOrder.length === 0 ? (
                    <AcpEmptyState />
                  ) : (
                    <AcpTimeline
                      snapshot={acpTimeline}
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

        <ChatInput
          onSend={(text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => {
            if (!currentSessionKey || !cwd) return;
            const targetAgent = targetAgentId
              ? agents.find((agent) => agent.id === targetAgentId) ?? null
              : null;
            const sessionKey = targetAgent
              ? targetAgent.mainSessionKey || `agent:${targetAgent.id}:main`
              : currentSessionKey;
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
            if (targetAgent) {
              selectAcpSession(sessionKey);
            }
            void (async () => {
              const existingSession = sessions.find((session) => session.key === sessionKey);
              const createIfMissing = !targetAgent && (!existingSession || !!existingSession.createdLocally);
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
                  acknowledgeAcpSessionCreated(sessionKey, promptCwd);
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
          disabled={acpLoading || acpCancelling || !cwd}
          sending={composerBusy}
          workspaceLabel={workspaceLabel}
          workspacePath={cwd}
          workspaceReadOnly={effectiveWorkspace.readOnly}
          onSelectWorkspace={setChatWorkspacePath}
        />
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
