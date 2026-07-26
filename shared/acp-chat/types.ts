import type {
  ContentBlock,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';

export type AcpJsonRecord = Record<string, unknown>;

export type AcpSessionKeyPayload = {
  sessionKey: string;
};

export type AcpChatLoadPayload = AcpSessionKeyPayload & {
  workspaceRoot: string;
  cwd: string;
  createIfMissing?: boolean;
};

export type AcpPromptMediaItem = {
  filePath: string;
  stagingId: string;
  fileName?: string;
  mimeType?: string;
};

export type AcpChatPromptPayload = AcpSessionKeyPayload & {
  cwd: string;
  message?: string;
  media?: AcpPromptMediaItem[];
  messageId?: string;
};

export type AcpChatCancelPayload = AcpSessionKeyPayload;

export type AcpChatRespondPermissionPayload = AcpSessionKeyPayload & {
  requestId: string;
  outcome: RequestPermissionResponse['outcome'];
};

export type AcpChatOperationResult = {
  success: boolean;
  error?: string;
  generation?: number;
  /** The requested session still has a live prompt and was reactivated without history replay. */
  resumedActivePrompt?: boolean;
  /** Raw notifications collected while session/load is in progress. */
  sessionUpdates?: AcpSessionUpdateEnvelope[];
};

export type AcpSessionUpdateEnvelope = {
  sessionKey: string;
  generation: number;
  /** True for ACP updates emitted while session/load is replaying history. */
  historical?: boolean;
  notification: SessionNotification;
};

export type AcpPermissionRequestEnvelope = {
  sessionKey: string;
  generation: number;
  requestId: string;
  request: RequestPermissionRequest;
};

export type AcpPromptContentBlock = ContentBlock;
