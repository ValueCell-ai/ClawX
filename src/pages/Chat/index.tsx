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
import type { AcpTimelineSnapshot, RenderPart } from '@/lib/acp/timeline-types';
import type { FileContentType, GeneratedFile } from '@/lib/generated-files';
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

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);
const DOCUMENT_EXTS = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.json', '.yaml', '.yml', '.toml', '.xml', '.sh', '.html', '.css', '.scss', '.sql']);
const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath;
}

function extnameOf(filePath: string): string {
  const name = basenameOf(filePath);
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function contentTypeForExt(ext: string): FileContentType {
  if (IMAGE_EXTS.has(ext)) return 'snapshot';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'other';
}

function normalizeAcpFilePath(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(value).pathname);
    } catch {
      return value.replace(/^file:\/\//, '');
    }
  }
  return value;
}

function isRecoverableInitialAcpLoadError(message: string | null): boolean {
  return !!message && message.includes("reply was never sent");
}

function buildAcpGeneratedFile(
  filePath: string,
  fileName: string | undefined,
  mimeType: string | undefined,
  lastSeenIndex: number,
): GeneratedFile {
  const ext = extnameOf(filePath);
  return {
    filePath,
    fileName: fileName || basenameOf(filePath),
    ext,
    mimeType: mimeType || MIME_BY_EXT[ext] || 'application/octet-stream',
    contentType: contentTypeForExt(ext),
    action: 'modified',
    lastSeenIndex,
  };
}

function addAcpGeneratedFile(
  map: Map<string, GeneratedFile>,
  filePath: string | null,
  fileName: string | undefined,
  mimeType: string | undefined,
  index: number,
) {
  if (!filePath) return;
  map.set(filePath, buildAcpGeneratedFile(filePath, fileName, mimeType, index));
}

function addAcpFilePart(map: Map<string, GeneratedFile>, part: RenderPart, index: number) {
  if (part.kind !== 'file') return;
  addAcpGeneratedFile(map, normalizeAcpFilePath(part.path), part.name, part.mimeType, index);
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function addAcpLocationFile(map: Map<string, GeneratedFile>, location: unknown, index: number) {
  if (!location || typeof location !== 'object') return;
  const record = location as Record<string, unknown>;
  const filePath = normalizeAcpFilePath(stringField(record, ['path', 'uri', 'filePath', 'file_path']));
  addAcpGeneratedFile(map, filePath, stringField(record, ['name', 'fileName', 'file_name']), undefined, index);
}

function deriveAcpGeneratedFiles(timeline: AcpTimelineSnapshot): GeneratedFile[] {
  const files = new Map<string, GeneratedFile>();
  timeline.itemOrder.forEach((id, itemIndex) => {
    const item = timeline.itemsById[id];
    if (!item) return;
    if (item.kind === 'message-segment') {
      if (item.role !== 'user') {
        item.parts.forEach((part, partIndex) => addAcpFilePart(files, part, itemIndex * 100 + partIndex));
      }
      return;
    }
    if (item.kind === 'thought') {
      item.parts.forEach((part, partIndex) => addAcpFilePart(files, part, itemIndex * 100 + partIndex));
      return;
    }
    if (item.kind === 'tool-call') {
      item.outputParts.forEach((part, partIndex) => addAcpFilePart(files, part, itemIndex * 100 + partIndex));
      item.locations.forEach((location, locationIndex) => addAcpLocationFile(files, location, itemIndex * 100 + 50 + locationIndex));
    }
  });
  return Array.from(files.values()).sort((a, b) => a.lastSeenIndex - b.lastSeenIndex);
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
    const hasStaleTimeline = acpTimeline.sessionId !== currentSessionKey || acpTimeline.itemOrder.length > 0;
    if (acpActiveSessionKey === currentSessionKey && acpCwd === cwd && !hasStaleTimeline) return;
    prepareLocalAcpSession({ sessionKey: currentSessionKey, cwd });
  }, [acpActiveSessionKey, acpCwd, acpTimeline.itemOrder.length, acpTimeline.sessionId, currentSession, currentSessionKey, cwd, prepareLocalAcpSession]);

  useEffect(() => {
    if (!currentSessionKey || !cwd) return;
    if (currentSessionKey === DEFAULT_SESSION_KEY && sessions.length === 0 && acpActiveSessionKey == null && !sessionDiscoveryAttempted) return;
    if (acpActiveSessionKey === currentSessionKey && acpCwd === cwd) return;
    const acpLoadKey = `${currentSessionKey}\0${cwd}`;
    if (acpLoadInFlightKeyRef.current === acpLoadKey) return;
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    if (currentSession?.createdLocally) return;
    const createIfMissing = !currentSession;
    acpLoadInFlightKeyRef.current = acpLoadKey;
    void loadAcpSession({
      sessionKey: currentSessionKey,
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
  }, [acknowledgeAcpSessionCreated, acpActiveSessionKey, acpCwd, currentSessionKey, cwd, loadAcpSession, sessionDiscoveryAttempted, sessions]);

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
  const acpGeneratedFiles = useMemo(() => deriveAcpGeneratedFiles(acpTimeline), [acpTimeline]);

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
            <ChatToolbar workspaceAvailable={!!cwd} />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden px-4 py-4">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-stretch">
            <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="chat-scroll-container">
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
                fileName: file.fileName,
                mimeType: file.mimeType,
              }));
            if (targetAgent) {
              selectAcpSession(sessionKey);
            }
            void (async () => {
              const existingSession = sessions.find((session) => session.key === sessionKey);
              const createIfMissing = !targetAgent && (!existingSession || !!existingSession.createdLocally);
              if (createIfMissing || acpActiveSessionKey !== sessionKey || acpCwd !== promptCwd) {
                const acpLoadKey = `${sessionKey}\0${promptCwd}`;
                acpLoadInFlightKeyRef.current = acpLoadKey;
                const loaded = await (async () => {
                  try {
                    return await loadAcpSession({
                      sessionKey,
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
              await sendAcpPrompt({
                sessionKey,
                cwd: promptCwd,
                message: text,
                media,
              });
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
                files={acpGeneratedFiles}
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
