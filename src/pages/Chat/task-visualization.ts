import { extractThinking, extractToolUse } from './message-utils';
import type { RawMessage, ToolStatus } from '@/stores/chat';

export type TaskStepStatus = 'running' | 'completed' | 'error';

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStepStatus;
  kind: 'thinking' | 'tool' | 'system';
  detail?: string;
  depth: number;
  parentId?: string;
}

const MAX_TASK_STEPS = 8;

interface DeriveTaskStepsInput {
  messages: RawMessage[];
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
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

    if (step.kind === 'thinking') {
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
  showThinking,
}: DeriveTaskStepsInput): TaskStep[] {
  const steps: TaskStep[] = [];
  const seenIds = new Set<string>();
  const activeToolNames = new Set<string>();

  const pushStep = (step: TaskStep): void => {
    if (seenIds.has(step.id)) return;
    seenIds.add(step.id);
    steps.push(step);
  };

  const streamMessage = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as RawMessage
    : null;

  if (streamMessage && showThinking) {
    const thinking = extractThinking(streamMessage);
    if (thinking) {
      pushStep({
        id: 'stream-thinking',
        label: 'Thinking',
        status: 'running',
        kind: 'thinking',
        detail: normalizeText(thinking),
        depth: 1,
      });
    }
  }

  streamingTools.forEach((tool, index) => {
    activeToolNames.add(tool.name);
    pushStep({
      id: tool.toolCallId || tool.id || makeToolId('stream-status', tool.name, index),
      label: tool.name,
      status: tool.status,
      kind: 'tool',
      detail: normalizeText(tool.summary),
      depth: 1,
    });
  });

  if (streamMessage) {
    extractToolUse(streamMessage).forEach((tool, index) => {
      if (activeToolNames.has(tool.name)) return;
      pushStep({
        id: tool.id || makeToolId('stream-tool', tool.name, index),
        label: tool.name,
        status: 'running',
        kind: 'tool',
        detail: normalizeText(JSON.stringify(tool.input, null, 2)),
        depth: 1,
      });
    });
  }

  if (sending && pendingFinal) {
    pushStep({
      id: 'system-finalizing',
      label: 'Finalizing answer',
      status: 'running',
      kind: 'system',
      detail: 'Waiting for the assistant to finish this run.',
      depth: 1,
    });
  } else if (sending && steps.length === 0) {
    pushStep({
      id: 'system-preparing',
      label: 'Preparing run',
      status: 'running',
      kind: 'system',
      detail: 'Waiting for the first streaming update.',
      depth: 1,
    });
  }

  if (steps.length === 0) {
    const relevantAssistantMessages = messages.filter((message) => {
      if (!message || message.role !== 'assistant') return false;
      if (extractToolUse(message).length > 0) return true;
      return showThinking && !!extractThinking(message);
    });

    for (const [messageIndex, assistantMessage] of relevantAssistantMessages.entries()) {
      if (showThinking) {
        const thinking = extractThinking(assistantMessage);
        if (thinking) {
          pushStep({
            id: `history-thinking-${assistantMessage.id || messageIndex}`,
            label: 'Thinking',
            status: 'completed',
            kind: 'thinking',
            detail: normalizeText(thinking),
            depth: 1,
          });
        }
      }

      extractToolUse(assistantMessage).forEach((tool, index) => {
        pushStep({
          id: tool.id || makeToolId(`history-tool-${assistantMessage.id || messageIndex}`, tool.name, index),
          label: tool.name,
          status: 'completed',
          kind: 'tool',
          detail: normalizeText(JSON.stringify(tool.input, null, 2)),
          depth: 1,
        });
      });
    }
  }

  return attachTopology(steps).slice(0, MAX_TASK_STEPS);
}
