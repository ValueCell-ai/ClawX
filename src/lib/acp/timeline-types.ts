import type { PlanEntry, SessionConfigOption, ToolCallLocation, ToolKind } from '@agentclientprotocol/sdk';

export type RenderPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; source: string; mimeType?: string; alt?: string }
  | { kind: 'file'; path?: string; name?: string; mimeType?: string }
  | { kind: 'error'; message: string };

export type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
  optimistic?: boolean;
  /** Renderer-only compatibility projection, not an ACP protocol event. */
  compat?: { source: 'image-generation'; evidenceId: string };
};

export type ThoughtItem = {
  kind: 'thought';
  id: string;
  messageId: string;
  parts: RenderPart[];
};

export type ToolCallItem = {
  kind: 'tool-call';
  id: string;
  toolCallId: string;
  title: string;
  toolKind?: ToolKind;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  outputParts: RenderPart[];
  locations: ToolCallLocation[];
  error?: string;
  /** Renderer-only: this item was produced by ACP replay during session load. */
  historical?: boolean;
};

export type PermissionItem = {
  kind: 'permission';
  id: string;
  requestId: string;
  toolCallId?: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
  status: 'pending' | 'selected' | 'cancelled';
};

export type PlanItem = {
  kind: 'plan';
  id: string;
  entries: PlanEntry[];
};

export type TimelineItem = MessageSegmentItem | ThoughtItem | ToolCallItem | PermissionItem | PlanItem;

export type AcpSessionMetadata = {
  currentModeId?: string;
  availableCommands?: unknown[];
  configOptions?: SessionConfigOption[];
  usage?: unknown;
  title?: string | null;
  updatedAt?: string | null;
};

export type AcpTimelineSnapshot = {
  sessionId: string;
  loadGeneration: number;
  itemOrder: string[];
  itemsById: Record<string, TimelineItem>;
  metadata: AcpSessionMetadata;
  openMessageSegments: Record<string, string>;
  segmentCounts: Record<string, number>;
};
