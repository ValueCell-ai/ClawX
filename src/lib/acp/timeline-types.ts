import type { PlanEntry, SessionConfigOption, ToolCallLocation, ToolKind } from '@agentclientprotocol/sdk';
import type {
  AttachmentAccessError,
  AttachmentFileRef,
  AttachmentRemoteRef,
} from '@shared/host-api/contract';

export type AttachmentUnavailableReason = AttachmentAccessError;

export type AttachmentAccessTarget =
  | {
      kind: 'local';
      scope: 'workspace' | 'openclaw-media' | 'staging';
      ref: AttachmentFileRef;
    }
  | { kind: 'remote'; ref: AttachmentRemoteRef; url: string };

export type AttachmentRenderPart = {
  kind: 'attachment';
  attachmentId: string;
  reference: {
    uri: string;
    name: string;
    displayPath?: string;
    mimeType?: string;
    size?: number;
    stagingId?: string;
    transcriptMessageId?: string;
  };
  source: 'acp-resource' | 'openclaw-media';
  evidenceId?: string;
  access:
    | { status: 'pending' }
    | { status: 'unavailable'; reason: AttachmentUnavailableReason }
    | {
        status: 'available';
        identity: string;
        target: AttachmentAccessTarget;
        mimeType: string;
        size: number;
      };
};

export type RenderPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; source: string; mimeType?: string; alt?: string; mediaIdentity?: string }
  | AttachmentRenderPart
  | { kind: 'error'; message: string };

export type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
  /** Binary-free text blocks produced by OpenClaw's ACP prompt flattening. */
  userPromptTextBlocks?: string[];
  /** Keep the locally-sent projection authoritative while ACP echoes prompt chunks. */
  userPromptTextBlocksOptimistic?: boolean;
  /** Number of ACP blocks consumed by this segment, independent of render-part coalescing. */
  blockCount?: number;
  optimistic?: boolean;
  /** Renderer-only compatibility projection, not an ACP protocol event. */
  compat?: { source: 'image-generation' | 'openclaw-media'; evidenceId: string };
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
