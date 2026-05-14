/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { buildBaselineRunKey, getBaseline } from '@/stores/baseline-cache';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ExecutionGraphCard } from './ExecutionGraphCard';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse, stripProcessMessagePrefix } from './message-utils';
import { deriveTaskSteps, findReplyMessageIndex, parseSubagentCompletionInfo, type TaskStep } from './task-visualization';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { useMinLoading } from '@/hooks/use-min-loading';
import { extractGeneratedFiles, generatedFileHasDiffPayload, type GeneratedFile } from '@/lib/generated-files';
import { GeneratedFilesPanel } from '@/components/file-preview/GeneratedFilesPanel';
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import type { AttachedFileMeta } from '@/stores/chat/types';
import { toast } from 'sonner';

const ArtifactPanelLazy = lazy(() =>
  import('@/components/file-preview/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
const PanelResizeDividerLazy = lazy(() =>
  import('@/components/file-preview/PanelResizeDivider').then((m) => ({ default: m.PanelResizeDivider })),
);

type GraphStepCacheEntry = {
  steps: ReturnType<typeof deriveTaskSteps>;
  agentLabel: string;
  sessionLabel: string;
  segmentEnd: number;
  replyIndex: number | null;
  triggerIndex: number;
};

type UserRunCard = {
  triggerIndex: number;
  replyIndex: number | null;
  active: boolean;
  agentLabel: string;
  sessionLabel: string;
  segmentEnd: number;
  steps: TaskStep[];
  messageStepTexts: string[];
  streamingReplyText: string | null;
  /**
   * Whether the trailing "Thinking..." indicator should be hidden for this
   * card. True only when the run's live stream is currently rendered AS a
   * streaming step inside the graph (the step itself already signals
   * liveness, so the extra indicator would be redundant). False in all
   * other cases — including when the stream is promoted to a bubble
   * below the graph, or when there is no streaming content at all (the
   * gap between tool rounds), because the graph has no visible activity
   * of its own in those windows and the indicator is what tells the user
   * "work is still in progress".
   */
  suppressThinking: boolean;
};

function getPrimaryMessageStepTexts(steps: TaskStep[]): string[] {
  return steps
    .filter((step) => step.kind === 'message' && step.parentId === 'agent-run' && !!step.detail)
    .map((step) => step.detail!);
}

function generatedFileToTarget(file: GeneratedFile): FilePreviewTarget {
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

// Keep the last non-empty execution-graph snapshot per session/run outside
// React state so `loadHistory` refreshes can still fall back to the previous
// steps without tripping React's set-state-in-effect lint rule.
const graphStepCacheStore = new Map<string, Record<string, GraphStepCacheEntry>>();
const streamingTimestampStore = new Map<string, number>();

export function Chat() {
  const { t } = useTranslation('chat');
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const loading = useChatStore((s) => s.loading);
  const loadingMoreHistory = useChatStore((s) => s.loadingMoreHistory);
  const hasMoreHistory = useChatStore((s) => s.hasMoreHistory);
  const loadMoreHistory = useChatStore((s) => s.loadMoreHistory);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const runError = useChatStore((s) => s.runError);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const agentsList = useAgentsStore((s) => s.agents);
  const currentAgent = useMemo(
    () => (agentsList ?? []).find((a) => a.id === currentAgentId) ?? null,
    [agentsList, currentAgentId],
  );
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const openChanges = useArtifactPanel((s) => s.openChanges);
  const openPreview = useArtifactPanel((s) => s.openPreview);
  const closeArtifactPanel = useArtifactPanel((s) => s.close);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  // Close the panel when the session changes — its contents would otherwise
  // be stale (file list belongs to the previous chat).
  useEffect(() => {
    closeArtifactPanel();
  }, [currentSessionKey, closeArtifactPanel]);
  const [childTranscripts, setChildTranscripts] = useState<Record<string, RawMessage[]>>({});

  // Callback for file cards in chat messages — opens the in-app preview
  // panel instead of the system default editor.
  const handleOpenAttachedFile = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
    if (file.mimeType === 'application/x-directory') {
      void invokeIpc('shell:openPath', file.filePath)
        .then((error) => {
          if (typeof error === 'string' && error) {
            toast.error(error);
          }
        })
        .catch(() => {
          toast.error(t('filePreview.errors.openInFinderFailed', '无法在文件管理器中显示'));
        });
      return;
    }
    const target = buildPreviewTarget(file.filePath, file.fileName, file.fileSize);
    openPreview(target);
  }, [openPreview, t]);
  // Persistent per-run override for the Execution Graph's expanded/collapsed
  // state. Keyed by a stable run id (trigger message id, or a fallback of
  // `${sessionKey}:${triggerIdx}`) so user toggles survive the `loadHistory`
  // refresh that runs after every final event — otherwise the card would
  // remount and reset. `undefined` values mean "user hasn't toggled, let the
  // card pick a default from its own `active` prop."
  const [graphExpandedOverrides, setGraphExpandedOverrides] = useState<Record<string, boolean>>({});
  const graphStepCache: Record<string, GraphStepCacheEntry> = graphStepCacheStore.get(currentSessionKey) ?? {};
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef } = useStickToBottomInstant(currentSessionKey);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    const completions = messages
      .map((message) => parseSubagentCompletionInfo(message))
      .filter((value): value is NonNullable<typeof value> => value != null);
    const missing = completions.filter((completion) => !childTranscripts[completion.sessionId]);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (completion) => {
        try {
          const result = await hostApiFetch<{ success: boolean; messages?: RawMessage[] }>(
            `/api/sessions/transcript?agentId=${encodeURIComponent(completion.agentId)}&sessionId=${encodeURIComponent(completion.sessionId)}`,
          );
          if (!result.success) {
            console.warn('Failed to load child transcript:', {
              agentId: completion.agentId,
              sessionId: completion.sessionId,
              result,
            });
            return null;
          }
          return { sessionId: completion.sessionId, messages: result.messages || [] };
        } catch (error) {
          console.warn('Failed to load child transcript:', {
            agentId: completion.agentId,
            sessionId: completion.sessionId,
            error,
          });
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setChildTranscripts((current) => {
        const next = { ...current };
        for (const result of results) {
          if (!result) continue;
          next[result.sessionId] = result.messages;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [messages, childTranscripts]);

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamTimestamp = typeof streamMsg?.timestamp === 'number' ? streamMsg.timestamp : 0;
  useEffect(() => {
    if (!sending) {
      streamingTimestampStore.delete(currentSessionKey);
      return;
    }
    if (!streamingTimestampStore.has(currentSessionKey)) {
      streamingTimestampStore.set(currentSessionKey, streamTimestamp || Date.now() / 1000);
    }
  }, [currentSessionKey, sending, streamTimestamp]);

  const streamingTimestamp = sending
    ? (streamingTimestampStore.get(currentSessionKey) ?? streamTimestamp)
    : 0;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  // Whether the streaming chunk currently carries a `thinking` block. Used as
  // a liveness signal so the run stays "active" (and the ExecutionGraphCard
  // keeps showing its trailing "Thinking..." indicator) during the brief window
  // between a tool finishing and the next text/tool chunk arriving — that gap
  // is normally only filled by streamed thinking. NOT included in
  // `shouldRenderStreaming`: a thinking-only stream chunk should not produce
  // a chat bubble (thinking is rendered exclusively inside the ExecutionGraph).
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const hasRunningStreamToolStatus = streamingTools.some((tool) => tool.status === 'running');
  const shouldRenderStreaming = sending && (hasStreamText || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !sending;
  const subagentCompletionInfos = messages.map((message) => parseSubagentCompletionInfo(message));
  // Build an index of the *next* real user message after each position.
  // Gateway history may contain `role: 'user'` messages that are actually
  // tool-result wrappers (Anthropic API format).  These must NOT split
  // the run into multiple segments — only genuine user-authored messages
  // should act as run boundaries.
  const isRealUserMessage = (msg: RawMessage): boolean => {
    if (msg.role !== 'user') return false;
    const content = msg.content;
    if (!Array.isArray(content)) return true;
    // If every block in the content is a tool_result, this is a Gateway
    // tool-result wrapper, not a real user message.
    const blocks = content as Array<{ type?: string }>;
    return blocks.length === 0 || !blocks.every((b) => b.type === 'tool_result');
  };
  const nextUserMessageIndexes = new Array<number>(messages.length).fill(-1);
  let nextUserMessageIndex = -1;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    nextUserMessageIndexes[idx] = nextUserMessageIndex;
    if (isRealUserMessage(messages[idx]) && !subagentCompletionInfos[idx]) {
      nextUserMessageIndex = idx;
    }
  }

  // Indices of intermediate assistant process messages that are represented
  // in the ExecutionGraphCard (narration text and/or thinking). We suppress
  // them from the chat stream so they don't appear duplicated below the graph.
  const foldedNarrationIndices = new Set<number>();

  const userRunCards: UserRunCard[] = messages.flatMap((message, idx) => {
    if (!isRealUserMessage(message) || subagentCompletionInfos[idx]) return [];

    const runKey = message.id
      ? `msg-${message.id}`
      : `${currentSessionKey}:trigger-${idx}`;
    const nextUserIndex = nextUserMessageIndexes[idx];
    const segmentEnd = nextUserIndex === -1 ? messages.length : nextUserIndex;
    const segmentMessages = messages.slice(idx + 1, segmentEnd);
    const completionInfos = subagentCompletionInfos
      .slice(idx + 1, segmentEnd)
      .filter((value): value is NonNullable<typeof value> => value != null);
    // A run is considered "open" (still active) when it's the last segment
    // AND at least one of:
    //  - sending/pendingFinal/streaming data (normal streaming path)
    //  - segment has tool calls but no pure-text final reply yet (server-side
    //    tool execution — Gateway fires phase "end" per tool round which
    //    briefly clears sending, but the run is still in progress)
    const hasToolActivity = segmentMessages.some((m) =>
      m.role === 'assistant' && extractToolUse(m).length > 0,
    );
    // Locate the last tool-use message so we only count text messages that
    // come AFTER all tool calls as "final reply".  Intermediate narration
    // messages (pure text, no tool_use) sit BEFORE tool calls and must not
    // be misread as the concluding reply — otherwise `runStillExecutingTools`
    // flips to false between tool rounds, collapsing the trailing
    // "Thinking..." indicator during the brief gap before the next stream chunk.
    let lastToolUseOffset = -1;
    for (let i = segmentMessages.length - 1; i >= 0; i -= 1) {
      const m = segmentMessages[i];
      if (m.role === 'assistant' && extractToolUse(m).length > 0) {
        lastToolUseOffset = i;
        break;
      }
    }
    const hasFinalReply = segmentMessages.some((m, i) => {
      if (i <= lastToolUseOffset) return false;
      if (m.role !== 'assistant') return false;
      if (extractText(m).trim().length === 0) return false;
      const content = m.content;
      if (!Array.isArray(content)) return true;
      return !(content as Array<{ type?: string }>).some(
        (b) => b.type === 'tool_use' || b.type === 'toolCall',
      );
    });
    const runStillExecutingTools = hasToolActivity && !hasFinalReply;
    // runStillExecutingTools bridges the brief gap between tool rounds when
    // Gateway temporarily clears sending.  However, after an explicit abort
    // (which clears activeRunId), we must NOT keep the run "open" — so we
    // gate it on activeRunId being present. We also bail out as soon as a
    // terminal model error has been surfaced so the run doesn't appear active.
    const isLatestRunSegment = nextUserIndex === -1;
    const isLatestOpenRun = isLatestRunSegment
      && !runError
      && (sending || pendingFinal || hasAnyStreamContent || (runStillExecutingTools && !!activeRunId));
    const replyIndexOffset = findReplyMessageIndex(segmentMessages, isLatestOpenRun);
    const replyIndex = replyIndexOffset === -1 ? null : idx + 1 + replyIndexOffset;

    const buildSteps = (omitLastStreamingMessageSegment: boolean): TaskStep[] => {
      let builtSteps = deriveTaskSteps({
        messages: segmentMessages,
        streamingMessage: isLatestOpenRun ? streamingMessage : null,
        streamingTools: isLatestOpenRun ? streamingTools : [],
        omitLastStreamingMessageSegment: isLatestOpenRun ? omitLastStreamingMessageSegment : false,
      });

      for (const completion of completionInfos) {
        const childMessages = childTranscripts[completion.sessionId];
        if (!childMessages || childMessages.length === 0) continue;
        const branchRootId = `subagent:${completion.sessionId}`;
        const childSteps = deriveTaskSteps({
          messages: childMessages,
          streamingMessage: null,
          streamingTools: [],
        }).map((step) => ({
          ...step,
          id: `${completion.sessionId}:${step.id}`,
          depth: step.depth + 1,
          parentId: branchRootId,
        }));

        builtSteps = [
          ...builtSteps,
          {
            id: branchRootId,
            label: `${completion.agentId} subagent`,
            status: 'completed',
            kind: 'system' as const,
            detail: completion.sessionKey,
            depth: 1,
            parentId: 'agent-run',
          },
          ...childSteps,
        ];
      }

      return builtSteps;
    };

    // Show the streaming response as a separate bubble (not inside the
    // execution graph) once tool activity has happened and the CURRENT stream
    // chunk carries no tool_use block.
    //
    // We use an optimistic promotion strategy because the distinguishing
    // signal between "narration-before-next-tool" and "final reply" is not
    // available during early deltas — both are text-only, both arrive after
    // `hasToolActivity` has flipped true.  Any of these signals opens the
    // promotion gate:
    //   1. `pendingFinal`       — tool-result final just fired; next text is
    //      (almost always) the final reply.
    //   2. `allToolsCompleted`  — every client-tracked tool entry reached
    //      `completed` state.
    //   3. `hasToolActivity`    — at least one prior tool_use exists in the
    //      segment, i.e. we're past the first tool round.
    //
    // Demotion happens the moment a tool_use block appears in the streaming
    // message (`streamTools.length > 0`) OR a tool transitions back to
    // `running`.  When demoted, the stream re-renders inside the graph as a
    // narration step.  A brief flicker when narration turns into the next
    // tool round is inherent to optimistic promotion and is accepted.
    //
    // Earlier iterations tried restricting this gate to only
    // `pendingFinal || allToolsCompleted` to protect the trailing
    // "Thinking..." indicator.  That check is real, but belongs in the
    // `suppressThinking` coupling below — not here.  With the coupling
    // fixed, the three-signal gate gives the correct bubble placement for
    // both narration and final reply.
    const allToolsCompleted = streamingTools.length > 0 && !hasRunningStreamToolStatus;
    const rawStreamingReplyCandidate = isLatestOpenRun
      && (pendingFinal || allToolsCompleted || hasToolActivity)
      && (hasStreamText || hasStreamImages)
      && streamTools.length === 0
      && !hasRunningStreamToolStatus;

    let steps = buildSteps(rawStreamingReplyCandidate);
    let streamingReplyText: string | null = null;
    if (rawStreamingReplyCandidate) {
      const trimmedReplyText = stripProcessMessagePrefix(streamText, getPrimaryMessageStepTexts(steps));
      const hasReplyText = trimmedReplyText.trim().length > 0;
      if (hasReplyText || hasStreamImages) {
        streamingReplyText = trimmedReplyText;
      } else {
        steps = buildSteps(false);
      }
    }

    const segmentAgentId = currentAgentId;
    const segmentAgentLabel = agents.find((agent) => agent.id === segmentAgentId)?.name || segmentAgentId;
    const segmentSessionLabel = sessionLabels[currentSessionKey] || currentSessionKey;

    if (steps.length === 0) {
      if (isLatestOpenRun && streamingReplyText == null) {
        return [{
          triggerIndex: idx,
          replyIndex,
          active: true,
          agentLabel: segmentAgentLabel,
          sessionLabel: segmentSessionLabel,
          segmentEnd: nextUserIndex === -1 ? messages.length - 1 : nextUserIndex - 1,
          steps: [],
          messageStepTexts: [],
          streamingReplyText: null,
          suppressThinking: false,
        }];
      }
      const cached = graphStepCache[runKey];
      if (!cached) return [];
      // The cache was captured during streaming and may contain stream-
      // generated message steps that include accumulated narration + reply
      // text.  Strip these out — historical message steps (from messages[])
      // will be properly recomputed on the next render with fresh data.
      const cleanedSteps = cached.steps.filter(
        (s) => !(s.kind === 'message' && s.id.startsWith('stream-message')),
      );
      return [{
        triggerIndex: idx,
        replyIndex: cached.replyIndex,
        active: false,
        agentLabel: cached.agentLabel,
        sessionLabel: cached.sessionLabel,
        segmentEnd: nextUserIndex === -1 ? messages.length - 1 : nextUserIndex - 1,
        steps: cleanedSteps,
        messageStepTexts: getPrimaryMessageStepTexts(cleanedSteps),
        streamingReplyText: null,
        suppressThinking: false,
      }];
    }

    // Mark intermediate assistant messages whose process output should be folded into
    // the ExecutionGraphCard. We fold the text regardless of whether the
    // message ALSO carries tool calls (mixed `text + toolCall` messages are
    // common — e.g. "waiting for the page to load…" followed by a `wait`
    // tool call). This prevents orphan narration bubbles from leaking into
    // the chat stream once the graph is collapsed.
    //
    // When the run is still streaming (`isLatestOpenRun`) the final reply is
    // not yet part of `segmentMessages`, so every assistant message in the
    // segment counts as intermediate. For completed runs, we preserve the
    // final reply bubble by skipping the message that `findReplyMessageIndex`
    // identifies as the answer.
    const segmentReplyOffset = findReplyMessageIndex(segmentMessages, isLatestOpenRun);
    for (let offset = 0; offset < segmentMessages.length; offset += 1) {
      if (offset === segmentReplyOffset) continue;
      const candidate = segmentMessages[offset];
      if (!candidate || candidate.role !== 'assistant') continue;
      const hasNarrationText = extractText(candidate).trim().length > 0;
      const hasThinking = !!extractThinking(candidate);
      if (!hasNarrationText && !hasThinking) continue;
      foldedNarrationIndices.add(idx + 1 + offset);
    }

    // The graph should stay "active" (expanded, can show trailing thinking)
    // for the entire duration of the run — not just until a streaming reply
    // appears.  Tying active to streamingReplyText caused a flicker: a brief
    // active→false→true transition collapsed the graph via ExecutionGraphCard's
    // uncontrolled path before the controlled `expanded` override could kick in.
    const cardActive = isLatestOpenRun;

    // Suppress the trailing "Thinking..." indicator only when the live stream is
    // currently rendered AS a streaming step inside this card's graph. In
    // that case the streaming step itself is the activity signal, and the
    // separate trailing indicator would be redundant.
    //   - streamingReplyText != null: stream is promoted to a bubble → graph
    //     has no live step of its own → DO show the trailing indicator so the
    //     user still sees progress in the graph (indicator rendered above the
    //     bubble).
    //   - no stream content at all (the gap between tool rounds): graph also
    //     has no live step → DO show the indicator — this is the very case
    //     the indicator exists for.
    //   - stream IS in graph (e.g. tool_use is streaming): indicator is
    //     redundant → suppress.
    const streamIsInGraph =
      isLatestOpenRun && streamingReplyText == null && hasAnyStreamContent;
    const suppressThinking = streamIsInGraph;

    return [{
      triggerIndex: idx,
      replyIndex,
      active: cardActive,
      agentLabel: segmentAgentLabel,
      sessionLabel: segmentSessionLabel,
      segmentEnd: nextUserIndex === -1 ? messages.length - 1 : nextUserIndex - 1,
      steps,
      messageStepTexts: getPrimaryMessageStepTexts(steps),
      streamingReplyText,
      suppressThinking,
    }];
  }, [messages, subagentCompletionInfos, currentSessionKey, streamingMessage, streamingTools, pendingFinal, sending, hasAnyStreamContent, hasStreamText, hasStreamImages, streamText, streamTools.length, hasRunningStreamToolStatus, childTranscripts, currentAgentId, agents, sessionLabels, graphStepCache, runError]);
  const hasActiveExecutionGraph = userRunCards.some((card) => card.active);
  const replyTextOverrides = useMemo(() => {
    const map = new Map<number, string>();
    for (const card of userRunCards) {
      if (card.replyIndex == null) continue;
      const replyMessage = messages[card.replyIndex];
      if (!replyMessage || replyMessage.role !== 'assistant') continue;
      const fullReplyText = extractText(replyMessage);
      const trimmedReplyText = stripProcessMessagePrefix(fullReplyText, card.messageStepTexts);
      if (trimmedReplyText !== fullReplyText) {
        map.set(card.replyIndex, trimmedReplyText);
      }
    }
    return map;
  }, [userRunCards, messages]);
  const streamingReplyText = userRunCards.find((card) => card.streamingReplyText != null)?.streamingReplyText ?? null;

  // Derive the set of run keys that should be auto-collapsed (run finished
  // streaming or has a reply override) during render instead of in an effect,
  // so we don't violate react-hooks/set-state-in-effect. Explicit user toggles
  // still win via `graphExpandedOverrides` and are merged in at the call site.
  // Pre-compute generated files per run (memoised so the cards and the
  // ArtifactPanel can both read them without re-parsing tool calls every
  // render).
  const filesByRun = useMemo(() => {
    const map = new Map<number, GeneratedFile[]>();
    for (const card of userRunCards) {
      const userTurnOrdinal = messages
        .slice(0, card.triggerIndex + 1)
        .filter((msg) => msg.role === 'user' && (!Array.isArray(msg.content) || !(msg.content as Array<{ type?: string }>).every((b) => b.type === 'tool_result' || b.type === 'toolResult')))
        .length;
      const runKey = buildBaselineRunKey(currentSessionKey, userTurnOrdinal);
      const raw = extractGeneratedFiles(
        messages,
        card.triggerIndex,
        card.segmentEnd,
        runKey ? (filePath) => getBaseline(runKey, filePath) : undefined,
      );
      map.set(card.triggerIndex, raw.filter(generatedFileHasDiffPayload));
    }
    return map;
  }, [currentSessionKey, userRunCards, messages]);
  const allGeneratedFiles = useMemo(() => {
    const all: GeneratedFile[] = [];
    for (const files of filesByRun.values()) all.push(...files);
    return all;
  }, [filesByRun]);

  const refreshSignal = useMemo(() => {
    if (sending) return undefined;
    return lastUserMessageAt ?? 0;
  }, [sending, lastUserMessageAt]);

  const autoCollapsedRunKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of userRunCards) {
      // Auto-collapse once the run is complete and a final reply exists.
      // Don't collapse while the reply is still streaming.
      const isStillStreaming = card.streamingReplyText != null;
      const shouldCollapse = !isStillStreaming && !card.active && card.replyIndex != null;
      if (!shouldCollapse) continue;
      const triggerMsg = messages[card.triggerIndex];
      const runKey = triggerMsg?.id
        ? `msg-${triggerMsg.id}`
        : `${currentSessionKey}:trigger-${card.triggerIndex}`;
      keys.add(runKey);
    }
    return keys;
  }, [currentSessionKey, messages, userRunCards]);

  useEffect(() => {
    if (userRunCards.length === 0) return;
    const current = graphStepCacheStore.get(currentSessionKey) ?? {};
    let changed = false;
    const next = { ...current };
    for (const card of userRunCards) {
      if (card.steps.length === 0) continue;
      const triggerMsg = messages[card.triggerIndex];
      const runKey = triggerMsg?.id
        ? `msg-${triggerMsg.id}`
        : `${currentSessionKey}:trigger-${card.triggerIndex}`;
      const existing = current[runKey];
      const sameSteps = !!existing
        && existing.steps.length === card.steps.length
        && existing.steps.every((step, index) => {
          const nextStep = card.steps[index];
          return nextStep
            && step.id === nextStep.id
            && step.label === nextStep.label
            && step.status === nextStep.status
            && step.kind === nextStep.kind
            && step.detail === nextStep.detail
            && step.depth === nextStep.depth
            && step.parentId === nextStep.parentId;
        });
      if (
        sameSteps
        && existing?.agentLabel === card.agentLabel
        && existing?.sessionLabel === card.sessionLabel
        && existing?.segmentEnd === card.segmentEnd
        && existing?.replyIndex === card.replyIndex
        && existing?.triggerIndex === card.triggerIndex
      ) {
        continue;
      }
      next[runKey] = {
        steps: card.steps,
        agentLabel: card.agentLabel,
        sessionLabel: card.sessionLabel,
        segmentEnd: card.segmentEnd,
        replyIndex: card.replyIndex,
        triggerIndex: card.triggerIndex,
      };
      changed = true;
    }
    if (changed) {
      graphStepCacheStore.set(currentSessionKey, next);
    }
  }, [userRunCards, messages, currentSessionKey]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  return (
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 -m-6 overflow-hidden transition-colors duration-500',
        'bg-background',
        isMac && 'rounded-tl-2xl shadow-[inset_1px_1px_0_hsl(var(--border)/0.55)]',
        isWindows && 'rounded-tl-2xl',
      )}
      style={{ height: isMac ? '100vh' : 'calc(100vh - 2.5rem)' }}
    >
      {/* Left column: chat */}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
        <div className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-4 lg:flex-row lg:items-stretch">
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div
              ref={contentRef}
              className={cn(
                "mx-auto space-y-4 transition-all duration-300",
                isEmpty ? "w-full max-w-3xl" : "max-w-4xl",
              )}
            >
              {isEmpty ? (
                <WelcomeScreen />
              ) : (
                <>
                  {hasMoreHistory && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => void loadMoreHistory()}
                        disabled={loadingMoreHistory}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="chat-load-more-history"
                      >
                        {loadingMoreHistory && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {loadingMoreHistory ? t('loadingMoreHistory', '加载更多中...') : t('loadMoreHistory', '加载更早的消息')}
                      </button>
                    </div>
                  )}
                  {messages.map((msg, idx) => {
                    if (foldedNarrationIndices.has(idx)) return null;
                    const suppressToolCards = userRunCards.some((card) =>
                      idx > card.triggerIndex && idx <= card.segmentEnd,
                    );
                    return (
                    <div
                      key={msg.id || `msg-${idx}`}
                      className="space-y-3"
                      id={`chat-message-${idx}`}
                      data-testid={`chat-message-${idx}`}
                    >
                      <ChatMessage
                        message={msg}
                        textOverride={replyTextOverrides.get(idx)}
                        suppressToolCards={suppressToolCards}
                        suppressProcessAttachments={suppressToolCards}
                        onOpenFile={handleOpenAttachedFile}
                      />
                      {userRunCards
                        .filter((card) => card.triggerIndex === idx)
                        .map((card) => {
                          const triggerMsg = messages[card.triggerIndex];
                          const runKey = triggerMsg?.id
                            ? `msg-${triggerMsg.id}`
                            : `${currentSessionKey}:trigger-${card.triggerIndex}`;
                          const userOverride = graphExpandedOverrides[runKey];
                          // Always use the controlled expanded prop instead of
                          // relying on ExecutionGraphCard's uncontrolled state.
                          // Uncontrolled state is lost on remount (key changes
                          // when loadHistory replaces message ids), causing
                          // spurious collapse.  The controlled prop survives
                          // remounts because it's computed fresh each render.
                          const expanded = userOverride != null
                            ? userOverride
                            : !autoCollapsedRunKeys.has(runKey);
                          const generatedFiles = filesByRun.get(card.triggerIndex) ?? [];
                          return (
                            <div key={`run-${currentSessionKey}:${card.triggerIndex}`} className="space-y-3">
                              <ExecutionGraphCard
                                key={`graph-${currentSessionKey}:${card.triggerIndex}`}
                                agentLabel={card.agentLabel}
                                steps={card.steps}
                                active={card.active}
                                suppressThinking={card.suppressThinking}
                                expanded={expanded}
                                onExpandedChange={(next) =>
                                  setGraphExpandedOverrides((prev) => ({ ...prev, [runKey]: next }))
                                }
                              />
                              {generatedFiles.length > 0 && (
                                <GeneratedFilesPanel
                                  files={generatedFiles}
                                  onOpen={(file) => openChanges(generatedFileToTarget(file))}
                                />
                              )}
                            </div>
                          );
                        })}
                    </div>
                    );
                  })}

                  {/* Streaming message — render when reply text is separated from graph,
                      OR when there's streaming content without an active graph */}
                  {shouldRenderStreaming && (streamingReplyText != null || !hasActiveExecutionGraph) && (
                    <ChatMessage
                      message={(() => {
                        const base = streamMsg
                          ? {
                              ...(streamMsg as Record<string, unknown>),
                              role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
                              content: streamMsg.content ?? streamText,
                              timestamp: streamMsg.timestamp ?? streamingTimestamp,
                            }
                          : {
                              role: 'assistant' as const,
                              content: streamText,
                              timestamp: streamingTimestamp,
                            };
                        // When the reply renders as a separate bubble, strip
                        // thinking blocks from the message — they belong to
                        // the execution phase and are already omitted from
                        // the graph via omitLastStreamingMessageSegment.
                        if (streamingReplyText != null && Array.isArray(base.content)) {
                          return {
                            ...base,
                            content: (base.content as Array<{ type?: string }>).filter(
                              (block) => block.type !== 'thinking',
                            ),
                          } as RawMessage;
                        }
                        return base as RawMessage;
                      })()}
                      textOverride={streamingReplyText ?? undefined}
                      isStreaming
                      streamingTools={streamingReplyText != null ? [] : streamingTools}
                      onOpenFile={handleOpenAttachedFile}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {sending && pendingFinal && !shouldRenderStreaming && !hasActiveExecutionGraph && (
                    <ActivityIndicator phase="tool_processing" />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                  {sending && !pendingFinal && !hasAnyStreamContent && !hasActiveExecutionGraph && (
                    <TypingIndicator />
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Run error callout */}
      {runError && (
        <div className="px-4 pt-2" data-testid="chat-run-error">
          <div className="max-w-4xl mx-auto rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t('runError.title')}
            </p>
            <p className="mt-1 text-sm text-destructive/90 break-words">
              {runError}
            </p>
          </div>
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-destructive/60 hover:text-destructive underline"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={sendMessage}
        onStop={abortRun}
        disabled={!isGatewayRunning}
        sending={sending || hasActiveExecutionGraph}
        isEmpty={isEmpty}
      />
      </div>

      {/* Right column: artifact / file preview panel (WorkBuddy-style) */}
      {panelOpen && (
        <>
          <Suspense fallback={null}>
            <PanelResizeDividerLazy containerRef={splitContainerRef} />
          </Suspense>
          <aside
            className="relative z-20 hidden shrink-0 border-l border-black/5 dark:border-white/10 lg:flex lg:flex-col"
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

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl pointer-events-auto">
          <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks') },
    { key: 'brainstorming', label: t('welcome.brainstorming') },
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1 className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight">
        {t('welcome.subtitle')}
      </h1>

      <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full">
        {quickActions.map(({ key, label }) => (
          <button 
            key={key}
            className="px-4 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-meta font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-black/[0.02]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
