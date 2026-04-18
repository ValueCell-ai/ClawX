import { extractText, extractThinking, extractToolUse } from './message-utils';
import type { RawMessage, ToolStatus } from '@/stores/chat';

export type TaskStepStatus = 'running' | 'completed' | 'error';

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStepStatus;
  kind: 'thinking' | 'tool' | 'system' | 'message';
  detail?: string;
  depth: number;
  parentId?: string;
}

/**
 * Detects the index of the "final reply" assistant message in a run segment.
 *
 * The reply is the last assistant message that carries non-empty text
 * content, regardless of whether it ALSO carries tool calls. (Mixed
 * `text + toolCall` replies are rare but real — the model can emit a parting
 * text block alongside a final tool call. Treating such a message as the
 * reply avoids mis-protecting an earlier narration as the "answer" and
 * leaking the actual last text into the fold.)
 *
 * When this returns a non-negative index, the caller should avoid folding
 * that message's text into the graph (it is the answer the user sees in the
 * chat stream). When the run is still active (streaming) the final reply is
 * produced via `streamingMessage` instead, so callers pass
 * `hasStreamingReply = true` to skip protection and let every assistant-with-
 * text message in history be folded into the graph as narration.
 */
export function findReplyMessageIndex(messages: RawMessage[], hasStreamingReply: boolean): number {
  if (hasStreamingReply) return -1;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (!message || message.role !== 'assistant') continue;
    if (extractText(message).trim().length === 0) continue;
    return idx;
  }
  return -1;
}

const MAX_TASK_STEPS = 8;

interface DeriveTaskStepsInput {
  messages: RawMessage[];
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  sending: boolean;
  pendingFinal: boolean;
}

export interface SubagentCompletionInfo {
  sessionKey: string;
  sessionId: string;
  agentId: string;
}

function normalizeText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized;
}

function makeToolId(prefix: string, name: string, index: number): string {
  return `${prefix}:${name}:${index}`;
}

export function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') return null;
  return parts[1] || null;
}

export function parseSubagentCompletionInfo(message: RawMessage): SubagentCompletionInfo | null {
  const text = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((block) => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('\n')
      : '';
  if (!text.includes('[Internal task completion event]')) return null;

  const sessionKeyMatch = text.match(/session_key:\s*(.+)/);
  const sessionIdMatch = text.match(/session_id:\s*(.+)/);
  const sessionKey = sessionKeyMatch?.[1]?.trim();
  const sessionId = sessionIdMatch?.[1]?.trim();
  if (!sessionKey || !sessionId) return null;
  const agentId = parseAgentIdFromSessionKey(sessionKey);
  if (!agentId) return null;
  return { sessionKey, sessionId, agentId };
}

function isSpawnLikeStep(label: string): boolean {
  return /(spawn|subagent|delegate|parallel)/i.test(label);
}

function tryParseJsonObject(detail: string | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractBranchAgent(step: TaskStep): string | null {
  const parsed = tryParseJsonObject(step.detail);
  const agentId = parsed?.agentId;
  if (typeof agentId === 'string' && agentId.trim()) return agentId.trim();

  const message = typeof parsed?.message === 'string' ? parsed.message : step.detail;
  if (!message) return null;
  const match = message.match(/\b(coder|reviewer|project-manager|manager|planner|researcher|worker|subagent)\b/i);
  return match ? match[1] : null;
}

function attachTopology(steps: TaskStep[]): TaskStep[] {
  const withTopology: TaskStep[] = [];
  let activeBranchNodeId: string | null = null;

  for (const step of steps) {
    if (step.kind === 'system') {
      activeBranchNodeId = null;
      withTopology.push({ ...step, depth: 1, parentId: 'agent-run' });
      continue;
    }

    if (/sessions_spawn/i.test(step.label)) {
      const branchAgent = extractBranchAgent(step) || 'subagent';
      const branchNodeId = `${step.id}:branch`;
      withTopology.push({ ...step, depth: 1, parentId: 'agent-run' });
      withTopology.push({
        id: branchNodeId,
        label: `${branchAgent} run`,
        status: step.status,
        kind: 'system',
        detail: `Spawned branch for ${branchAgent}`,
        depth: 2,
        parentId: step.id,
      });
      activeBranchNodeId = branchNodeId;
      continue;
    }

    if (/sessions_yield/i.test(step.label)) {
      withTopology.push({
        ...step,
        depth: activeBranchNodeId ? 3 : 1,
        parentId: activeBranchNodeId ?? 'agent-run',
      });
      activeBranchNodeId = null;
      continue;
    }

    if (step.kind === 'thinking' || step.kind === 'message') {
      withTopology.push({
        ...step,
        depth: activeBranchNodeId ? 3 : 1,
        parentId: activeBranchNodeId ?? 'agent-run',
      });
      continue;
    }

    if (isSpawnLikeStep(step.label)) {
      activeBranchNodeId = step.id;
      withTopology.push({
        ...step,
        depth: 1,
        parentId: 'agent-run',
      });
      continue;
    }

    withTopology.push({
      ...step,
      depth: activeBranchNodeId ? 3 : 1,
      parentId: activeBranchNodeId ?? 'agent-run',
    });
  }

  return withTopology;
}

export function deriveTaskSteps({
  messages,
  streamingMessage,
  streamingTools,
  sending,
  pendingFinal,
}: DeriveTaskStepsInput): TaskStep[] {
  const steps: TaskStep[] = [];
  const stepIndexById = new Map<string, number>();

  const upsertStep = (step: TaskStep): void => {
    const existingIndex = stepIndexById.get(step.id);
    if (existingIndex == null) {
      stepIndexById.set(step.id, steps.length);
      steps.push(step);
      return;
    }
    const existing = steps[existingIndex];
    steps[existingIndex] = {
      ...existing,
      ...step,
      detail: step.detail ?? existing.detail,
    };
  };

  const streamMessage = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as RawMessage
    : null;

  // The final answer the user sees as a chat bubble. We avoid folding it into
  // the graph to prevent duplication. When a run is still streaming, the
  // reply lives in `streamingMessage`, so every pure-text assistant message in
  // `messages` is treated as intermediate narration.
  const replyIndex = findReplyMessageIndex(messages, streamMessage != null);

  for (const [messageIndex, message] of messages.entries()) {
    if (!message || message.role !== 'assistant') continue;

    const thinking = extractThinking(message);
    if (thinking) {
      upsertStep({
        id: `history-thinking-${message.id || messageIndex}`,
        label: 'Thinking',
        status: 'completed',
        kind: 'thinking',
        detail: normalizeText(thinking),
        depth: 1,
      });
    }

    const toolUses = extractToolUse(message);
    // Fold any intermediate assistant text into the graph as a narration
    // step — including text that lives on a mixed `text + toolCall` message.
    // The narration step is emitted BEFORE the tool steps so the graph
    // preserves the original ordering (the assistant "thinks out loud" and
    // then invokes the tool).
    const narrationText = extractText(message).trim();
    const isIntermediateNarration = narrationText.length > 0
      && messageIndex !== replyIndex;
    if (isIntermediateNarration) {
      upsertStep({
        id: `history-message-${message.id || messageIndex}`,
        label: 'Message',
        status: 'completed',
        kind: 'message',
        detail: normalizeText(extractText(message)),
        depth: 1,
      });
    }

    toolUses.forEach((tool, index) => {
      upsertStep({
        id: tool.id || makeToolId(`history-tool-${message.id || messageIndex}`, tool.name, index),
        label: tool.name,
        status: 'completed',
        kind: 'tool',
        detail: normalizeText(JSON.stringify(tool.input, null, 2)),
        depth: 1,
      });
    });
  }

  if (streamMessage) {
    const thinking = extractThinking(streamMessage);
    if (thinking) {
      upsertStep({
        id: 'stream-thinking',
        label: 'Thinking',
        status: 'running',
        kind: 'thinking',
        detail: normalizeText(thinking),
        depth: 1,
      });
    }
  }

  const activeToolIds = new Set<string>();
  const activeToolNamesWithoutIds = new Set<string>();
  streamingTools.forEach((tool, index) => {
    const id = tool.toolCallId || tool.id || makeToolId('stream-status', tool.name, index);
    activeToolIds.add(id);
    if (!tool.toolCallId && !tool.id) {
      activeToolNamesWithoutIds.add(tool.name);
    }
    upsertStep({
      id,
      label: tool.name,
      status: tool.status,
      kind: 'tool',
      detail: normalizeText(tool.summary),
      depth: 1,
    });
  });

  if (streamMessage) {
    extractToolUse(streamMessage).forEach((tool, index) => {
      const id = tool.id || makeToolId('stream-tool', tool.name, index);
      if (activeToolIds.has(id) || activeToolNamesWithoutIds.has(tool.name)) return;
      upsertStep({
        id,
        label: tool.name,
        status: 'running',
        kind: 'tool',
        detail: normalizeText(JSON.stringify(tool.input, null, 2)),
        depth: 1,
      });
    });
  }

  if (sending && pendingFinal) {
      upsertStep({
        id: 'system-finalizing',
        label: 'Finalizing answer',
        status: 'running',
      kind: 'system',
      detail: 'Waiting for the assistant to finish this run.',
      depth: 1,
    });
  } else if (sending && steps.length === 0) {
      upsertStep({
        id: 'system-preparing',
        label: 'Preparing run',
        status: 'running',
      kind: 'system',
      detail: 'Waiting for the first streaming update.',
      depth: 1,
    });
  }

  const withTopology = attachTopology(steps);
  return withTopology.length > MAX_TASK_STEPS
    ? withTopology.slice(-MAX_TASK_STEPS)
    : withTopology;
}
