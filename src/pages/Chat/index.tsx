/**
 * Chat Page
 *
 * Electron renderer shell for the OpenClaw-backed chat surface. Backend
 * communication stays behind the Main-owned host API; this component only
 * wires layout, toolbar state, error chrome, artifact panel, and the existing
 * ClawX composer.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RawOpenClawMessage } from '@/chat-core/openclaw-port/types';
import { extractDisplayMessageText, stripMediaAttachmentReferences } from '@/chat-core/openclaw-port/history';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { buildBaselineRunKey, getBaseline } from '@/stores/baseline-cache';
import {
  extractGeneratedFiles,
  generatedFileHasDiffPayload,
  isHtmlPreviewExt,
  type GeneratedFile,
} from '@/lib/generated-files';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore, type AttachedFileMeta, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useOpenClawChatSurfaceStore } from '@/stores/openclaw-chat-surface';
import { ChatInput, type FileAttachment } from './ChatInput';
import { ChatSurface } from './ChatSurface';
import { ChatToolbar } from './ChatToolbar';
import { chatMessageAnchorId } from './message-utils';

const ArtifactPanelLazy = lazy(() =>
  import('@/components/file-preview/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
const PanelResizeDividerLazy = lazy(() =>
  import('@/components/file-preview/PanelResizeDivider').then((m) => ({ default: m.PanelResizeDivider })),
);

const QUESTION_DIRECTORY_RENDER_LIMIT = 300;
const SURFACE_POST_SEND_HISTORY_RELOAD_DELAYS_MS = [0, 500, 1500] as const;
const noopLoadLegacyHistory = () => undefined;

type DirectoryMessage = Pick<RawOpenClawMessage, 'role' | 'content' | 'text'>;

type QuestionDirectoryItem = {
  index: number;
  ordinal: number;
  targetId: string;
  title: string;
};

function ComposerActivityPulse({ label }: { label: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-1" data-testid="chat-running-pulse">
      <div className="flex items-center px-1">
        <div
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
          role="status"
          aria-label={label}
          title={label}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function isToolResultWrapper(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  const blocks = content as Array<{ type?: unknown }>;
  return blocks.length > 0 && blocks.every((block) => (
    block.type === 'tool_result' || block.type === 'toolResult'
  ));
}

function isRealUserDirectoryMessage(message: DirectoryMessage): boolean {
  return message.role === 'user' && !isToolResultWrapper(message.content);
}

function buildQuestionDirectoryTitle(message: DirectoryMessage, fallback: string): string {
  const normalized = stripMediaAttachmentReferences(
    extractDisplayMessageText(message as RawOpenClawMessage),
  ).replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
}

function historyMessageSignature(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const content = record.content;
  const text = typeof record.text === 'string' ? record.text : '';
  const contentText = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block) => {
        if (!block || typeof block !== 'object') return '';
        const blockRecord = block as Record<string, unknown>;
        if (typeof blockRecord.text === 'string') return blockRecord.text;
        if (typeof blockRecord.thinking === 'string') return blockRecord.thinking;
        return typeof blockRecord.type === 'string' ? blockRecord.type : '';
      }).join('|')
      : text;

  return [
    typeof record.id === 'string' ? record.id : '',
    typeof record.timestamp === 'number' ? record.timestamp : '',
    typeof record.role === 'string' ? record.role : '',
    typeof record.model === 'string' ? record.model : '',
    contentText.slice(0, 160),
  ].join(':');
}

function legacyHistorySignature(sessionKey: string, messages: unknown[]): string {
  return `${sessionKey}:${messages.length}:${historyMessageSignature(messages.at(-1))}`;
}

function legacyMessageId(message: RawMessage, index: number): string {
  return String(message.id ?? `legacy-message-${index}`);
}

function legacyMessagesToVisibleItems(messages: RawMessage[]): RawOpenClawMessage[] {
  return messages.map((message, index) => ({
    ...(message as RawOpenClawMessage),
    id: legacyMessageId(message, index),
  }));
}

function isRealUserRunTrigger(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  return !isToolResultWrapper(message.content);
}

function generatedFileToPreviewTarget(file: GeneratedFile) {
  return {
    filePath: file.filePath,
    fileName: file.fileName,
    ext: file.ext,
    mimeType: file.mimeType,
    contentType: file.contentType,
    action: file.action,
    fullContent: file.fullContent,
    baseline: file.baseline,
    edits: file.edits,
  };
}

function isAbsoluteFilePath(filePath: string): boolean {
  return (
    filePath.startsWith('/')
    || filePath.startsWith('~/')
    || /^[A-Za-z]:[\\/]/.test(filePath)
  );
}

function resolveAgentWorkspacePath(filePath: string, workspace?: string | null): string {
  if (isAbsoluteFilePath(filePath) || !workspace?.trim()) return filePath;
  return `${workspace.replace(/[\\/]+$/, '')}/${filePath.replace(/^\.?[\\/]+/, '')}`;
}

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;

  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const legacyMessages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const runError = useChatStore((s) => s.runError);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortLegacyRun = useChatStore((s) => s.abortRun);
  const refresh = useChatStore((s) => s.refresh);
  const loadLegacyHistory = useChatStore((s) => s.loadHistory ?? noopLoadLegacyHistory);
  const clearError = useChatStore((s) => s.clearError);
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const thinkingLevel = useChatStore((s) => s.thinkingLevel);

  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agentsList = useAgentsStore((s) => s.agents);
  const currentAgent = useMemo(
    () => (agentsList ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agentsList, currentAgentId],
  );

  const visibleSurfaceItems = useOpenClawChatSurfaceStore((state) => state.visibleItems);
  const surfaceSendState = useOpenClawChatSurfaceStore((state) => state.core.send);
  const surfaceRunStatus = useOpenClawChatSurfaceStore((state) => state.core.runtime.runStatus);
  const initSurfaceHostSubscriptions = useOpenClawChatSurfaceStore((state) => state.initHostSubscriptions);
  const disposeSurfaceHostSubscriptions = useOpenClawChatSurfaceStore((state) => state.disposeHostSubscriptions);
  const setSurfaceSessionKey = useOpenClawChatSurfaceStore((state) => state.setSessionKey);
  const loadSurfaceHistory = useOpenClawChatSurfaceStore((state) => state.loadHistory);
  const enqueueSurfaceOptimisticUserMessage = useOpenClawChatSurfaceStore((state) => state.enqueueOptimisticUserMessage);
  const setSurfaceThinkingLevel = useOpenClawChatSurfaceStore((state) => state.setThinkingLevel);
  const abortSurfaceRun = useOpenClawChatSurfaceStore((state) => state.abortRun);
  const resolveSurfaceApproval = useOpenClawChatSurfaceStore((state) => state.resolveApproval);

  const panelOpen = useArtifactPanel((s) => s.open);
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const openArtifactPreview = useArtifactPanel((s) => s.openPreview);
  const openArtifactChanges = useArtifactPanel((s) => s.openChanges);
  const closeArtifactPanel = useArtifactPanel((s) => s.close);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const legacyHistorySyncSignatureRef = useRef<string | null>(null);
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);
  const surfaceRunning = Boolean(
    surfaceRunStatus?.phase === 'running'
    || surfaceSendState?.sending
    || surfaceSendState?.canAbort,
  );
  const composerSending = sending || surfaceRunning;
  const showRunningPulse = composerSending || surfaceRunning;
  const legacyMessagesSignature = useMemo(
    () => legacyHistorySignature(currentSessionKey, legacyMessages),
    [currentSessionKey, legacyMessages],
  );
  const legacyVisibleMessages = useMemo(
    () => legacyMessagesToVisibleItems(legacyMessages),
    [legacyMessages],
  );
  const surfaceItemsForRender = useMemo(() => {
    if (visibleSurfaceItems.length > 0) return visibleSurfaceItems;
    return legacyVisibleMessages.map((message, index) => ({
      kind: 'message' as const,
      id: legacyMessageId(legacyMessages[index]!, index),
      message,
    }));
  }, [legacyMessages, legacyVisibleMessages, visibleSurfaceItems]);

  useEffect(() => {
    return () => {
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    initSurfaceHostSubscriptions();
    return () => disposeSurfaceHostSubscriptions();
  }, [disposeSurfaceHostSubscriptions, initSurfaceHostSubscriptions]);

  useEffect(() => {
    setSurfaceSessionKey(currentSessionKey, currentAgentId);
    if (!isGatewayRunning) return;
    void Promise.resolve(loadLegacyHistory(false)).catch(() => {
      // Compatibility data source for local transcript fallback and generated
      // file cards. The OpenClaw surface remains the primary renderer.
    });
    void loadSurfaceHistory().catch(() => {
      // Unit tests and early renderer boot can briefly lack the Electron
      // host bridge. Keep the shell mounted; gateway status/error chrome
      // covers real runtime failures.
    });
  }, [currentAgentId, currentSessionKey, isGatewayRunning, loadLegacyHistory, loadSurfaceHistory, setSurfaceSessionKey]);

  useEffect(() => {
    setSurfaceThinkingLevel(thinkingLevel ?? null);
  }, [setSurfaceThinkingLevel, thinkingLevel]);

  useEffect(() => {
    if (!isGatewayRunning) {
      legacyHistorySyncSignatureRef.current = null;
      return;
    }

    if (legacyHistorySyncSignatureRef.current === null) {
      legacyHistorySyncSignatureRef.current = legacyMessagesSignature;
      return;
    }

    if (legacyHistorySyncSignatureRef.current === legacyMessagesSignature) return;
    legacyHistorySyncSignatureRef.current = legacyMessagesSignature;

    void loadSurfaceHistory().catch(() => {
      // Some legacy-store changes happen during early renderer boot or gateway
      // reconnect. The primary session/gateway effect still performs the
      // canonical load and retries through normal gateway status handling.
    });
  }, [isGatewayRunning, legacyMessagesSignature, loadSurfaceHistory]);

  useEffect(() => {
    closeArtifactPanel();
  }, [currentSessionKey, closeArtifactPanel]);

  const questionDirectoryItems = useMemo<QuestionDirectoryItem[]>(() => {
    const messageSources = surfaceItemsForRender
      .map((item, index) => (item.kind === 'message' ? { index, itemId: item.id, message: item.message } : null))
      .filter((item): item is { index: number; itemId: string; message: RawOpenClawMessage } => item != null);
    const sourceMessages = messageSources.length > 0
      ? messageSources
      : legacyMessages.map((message, index) => ({
        index,
        itemId: legacyMessageId(message, index),
        message: message as RawOpenClawMessage,
      }));

    const items: QuestionDirectoryItem[] = [];
    let questionOrdinal = 0;
    for (const { index, itemId, message } of sourceMessages) {
      if (!isRealUserDirectoryMessage(message)) continue;
      questionOrdinal += 1;
      items.push({
        index,
        ordinal: questionOrdinal,
        targetId: chatMessageAnchorId(message.id ?? itemId ?? index) ?? `chat-message-${index}`,
        title: buildQuestionDirectoryTitle(
          message,
          t('questionDirectory.fallback', { number: questionOrdinal }),
        ),
      });
    }
    return items;
  }, [legacyMessages, surfaceItemsForRender, t]);

  const questionDirectoryVisible =
    questionDirectoryOpenSessionKey === currentSessionKey && questionDirectoryItems.length > 1;

  const refreshSignal = useMemo(() => {
    if (sending) return undefined;
    return lastUserMessageAt ?? 0;
  }, [sending, lastUserMessageAt]);

  const handleRefresh = useCallback(() => {
    void refresh();
    void loadSurfaceHistory().catch(() => {
      // Keep the toolbar action best-effort; gateway status/error chrome covers
      // real runtime failures, and explicit session load will retry.
    });
  }, [loadSurfaceHistory, refresh]);

  const handleSend = useCallback((
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
  ) => {
    const sessionKeyAtSend = currentSessionKey;
    if (!targetAgentId || targetAgentId === currentAgentId) {
      setSurfaceSessionKey(currentSessionKey, currentAgentId);
      enqueueSurfaceOptimisticUserMessage(text, attachments);
    }
    void Promise.resolve(sendMessage(text, attachments, targetAgentId)).finally(() => {
      if (targetAgentId && targetAgentId !== currentAgentId) return;
      for (const delayMs of SURFACE_POST_SEND_HISTORY_RELOAD_DELAYS_MS) {
        setTimeout(() => {
          if (useChatStore.getState().currentSessionKey !== sessionKeyAtSend) return;
          void loadSurfaceHistory().catch(() => {
            // Gateway events remain the primary live source. This post-send
            // refresh covers providers/runtimes that complete via the blocking
            // send RPC before the surface has received a terminal event.
          });
        }, delayMs);
      }
    });
  }, [
    currentAgentId,
    currentSessionKey,
    enqueueSurfaceOptimisticUserMessage,
    loadSurfaceHistory,
    sendMessage,
    setSurfaceSessionKey,
  ]);

  const handleOpenMessageFile = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
    const filePath = resolveAgentWorkspacePath(file.filePath, currentAgent?.workspace);
    openArtifactPreview(buildPreviewTarget(filePath, file.fileName, file.fileSize));
  }, [currentAgent?.workspace, openArtifactPreview]);

  const handleOpenGeneratedFile = useCallback((file: GeneratedFile) => {
    const target = generatedFileToPreviewTarget(file);
    if (isHtmlPreviewExt(file.ext)) {
      openArtifactPreview(target);
      return;
    }
    openArtifactChanges(target);
  }, [openArtifactChanges, openArtifactPreview]);

  const generatedFilesByMessageId = useMemo(() => {
    const messagesForExtraction = legacyMessages.length > 0
      ? legacyMessages
      : surfaceItemsForRender
        .filter((item) => item.kind === 'message')
        .map((item) => item.message as RawMessage);
    const generatedById: Record<string, GeneratedFile[]> = {};
    let userTurnOrdinal = 0;

    for (let index = 0; index < messagesForExtraction.length; index += 1) {
      const message = messagesForExtraction[index];
      if (!message || !isRealUserRunTrigger(message)) continue;
      userTurnOrdinal += 1;

      let segmentEnd = messagesForExtraction.length - 1;
      for (let nextIndex = index + 1; nextIndex < messagesForExtraction.length; nextIndex += 1) {
        const nextMessage = messagesForExtraction[nextIndex];
        if (nextMessage && isRealUserRunTrigger(nextMessage)) {
          segmentEnd = nextIndex - 1;
          break;
        }
      }

      const runKey = buildBaselineRunKey(currentSessionKey, userTurnOrdinal);
      const files = extractGeneratedFiles(
        messagesForExtraction,
        index,
        segmentEnd,
        runKey ? (filePath) => getBaseline(runKey, filePath) : undefined,
      ).filter(generatedFileHasDiffPayload);
      if (files.length === 0) continue;
      generatedById[legacyMessageId(message, index)] = files;
    }

    return generatedById;
  }, [currentSessionKey, legacyMessages, surfaceItemsForRender]);

  const allGeneratedFiles = useMemo(
    () => Object.values(generatedFilesByMessageId).flat(),
    [generatedFilesByMessageId],
  );

  const handleStop = useCallback(() => {
    void abortSurfaceRun();
    void abortLegacyRun();
  }, [abortLegacyRun, abortSurfaceRun]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  return (
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 -m-6 overflow-hidden bg-background transition-colors duration-500',
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
              onToggleQuestionDirectory={() =>
                setQuestionDirectoryOpenSessionKey((openSessionKey) =>
                  openSessionKey === currentSessionKey ? null : currentSessionKey,
                )
              }
              onRefresh={handleRefresh}
            />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-stretch">
            <ChatSurface
              items={surfaceItemsForRender}
              generatedFilesByMessageId={generatedFilesByMessageId}
              questionDirectory={questionDirectoryVisible ? <QuestionDirectory items={questionDirectoryItems} /> : null}
              onOpenFile={handleOpenMessageFile}
              onOpenGeneratedFile={handleOpenGeneratedFile}
              onResolveApproval={(id, decision) => {
                void resolveSurfaceApproval(id, decision);
              }}
            />
          </div>
        </div>

        {runError && (
          <div className="px-4 pt-2" data-testid="chat-run-error">
            <div className="mx-auto max-w-4xl rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {t('runError.title')}
                </p>
                <button
                  type="button"
                  onClick={clearError}
                  className="shrink-0 text-xs text-destructive/60 underline hover:text-destructive"
                  data-testid="chat-run-error-dismiss"
                >
                  {t('common:actions.dismiss')}
                </button>
              </div>
              <p className="mt-1 break-words text-sm text-destructive/90">{runError}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2">
            <div className="mx-auto flex max-w-4xl items-center justify-between">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </p>
              <button
                type="button"
                onClick={clearError}
                className="text-xs text-destructive/60 underline hover:text-destructive"
              >
                {t('common:actions.dismiss')}
              </button>
            </div>
          </div>
        )}

        {showRunningPulse ? <ComposerActivityPulse label={t('composer.runningPulse')} /> : null}
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          disabled={!isGatewayRunning}
          sending={composerSending}
          draftScopeKey={currentSessionKey}
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
              fallback={
                <div className="flex h-full items-center justify-center">
                  <LoadingSpinner size="md" />
                </div>
              }
            >
              <ArtifactPanelLazy
                files={allGeneratedFiles}
                agent={currentAgent}
                runStartedAt={lastUserMessageAt ?? null}
                refreshSignal={refreshSignal}
              />
            </Suspense>
          </aside>
        </>
      )}

    </div>
  );
}

function QuestionDirectory({ items }: { items: QuestionDirectoryItem[] }) {
  const { t } = useTranslation('chat');
  const scrollRef = useRef<HTMLElement | null>(null);
  const visibleItems =
    items.length > QUESTION_DIRECTORY_RENDER_LIMIT
      ? items.slice(-QUESTION_DIRECTORY_RENDER_LIMIT)
      : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const lastItemKey = visibleItems.at(-1)?.index ?? -1;

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const scrollToEnd = () => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    };

    scrollToEnd();
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(scrollToEnd);
    });

    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(scrollToEnd);
    observer.observe(scrollEl);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [lastItemKey, visibleItems.length]);

  const handleJumpToMessage = (item: QuestionDirectoryItem) => {
    const target = document.getElementById(item.targetId) ?? document.getElementById(`chat-message-${item.index}`);
    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <aside
      data-testid="chat-question-directory"
      className="order-1 flex max-h-44 min-h-0 w-full shrink-0 self-stretch lg:order-2 lg:max-h-none lg:w-64 xl:w-72"
      aria-label={t('questionDirectory.title')}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col rounded-lg border border-black/5 bg-black/[0.02] p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.03] lg:sticky lg:top-2">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('questionDirectory.title')}
          </h2>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10">
            {items.length}
          </span>
        </div>
        <nav ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {visibleItems.map((item) => (
            <button
              key={item.index}
              type="button"
              data-testid={`chat-question-directory-item-${item.index}`}
              data-target-id={item.targetId}
              onClick={() => handleJumpToMessage(item)}
              className={cn(
                'group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              )}
              title={item.title}
            >
              <span className="line-clamp-2 min-w-0 text-xs leading-5">
                {item.title}
              </span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <div className="px-2 py-2 text-xs leading-5 text-muted-foreground">
              {t('questionDirectory.moreHint', { count: hiddenCount })}
            </div>
          )}
        </nav>
      </div>
    </aside>
  );
}

export default Chat;
