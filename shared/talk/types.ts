export type TalkTerminalReason = 'completed' | 'cancelled' | 'error' | 'disconnected' | (string & {});

export type TalkCatalogReadiness =
  | { ready: true }
  | { ready: false; reason?: string }
  | { ready?: undefined };

export type TalkCatalogProvider = {
  id: string;
  label: string;
  configured: boolean;
  models?: string[];
  defaultModel?: string;
  voices?: string[];
  transports?: string[];
  brains?: string[];
};

export type TalkCatalog = {
  modes: string[];
  transports: string[];
  brains: string[];
  realtime: TalkCatalogReadiness & {
    activeProvider?: string;
    providers: TalkCatalogProvider[];
  };
};

export type TalkPcm16AudioContract = {
  inputEncoding: 'pcm16';
  inputSampleRateHz: number;
  outputEncoding: 'pcm16';
  outputSampleRateHz: number;
};

export type TalkRelaySession = {
  relaySessionId: string;
  provider: string;
  transport: 'gateway-relay';
  audio: TalkPcm16AudioContract;
  model?: string;
  voice?: string;
  expiresAt?: number;
};

export type TalkRelayEventBase = {
  relaySessionId: string;
  talkEvent?: unknown;
};

export type TalkRelayEvent = TalkRelayEventBase & (
  | { type: 'ready' }
  | { type: 'audio'; audioBase64: string }
  | { type: 'audioDone'; itemId?: string; responseId?: string }
  | { type: 'clear'; reason?: 'barge-in' }
  | { type: 'mark'; markName: string }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; final: boolean }
  | { type: 'toolCall'; callId: string; name: string; args: Record<string, unknown>; forced?: boolean }
  | { type: 'toolCallCancelled'; callId: string }
  | { type: 'toolResult'; callId: string; final?: boolean }
  | { type: 'error'; message: string }
  | { type: 'close'; reason: TalkTerminalReason }
);

export type TalkStartRelayPayload = { sessionKey: string };
export type TalkRealtimeSettingsPayload = {
  provider: string;
  model: string;
  speakerVoice?: string;
};
export type TalkRelayIdPayload = { relaySessionId: string };
export type TalkAppendAudioPayload = TalkRelayIdPayload & {
  audioBase64: string;
  timestamp?: number;
};
export type TalkSubmitToolResultPayload = TalkRelayIdPayload & {
  callId: string;
  result: unknown;
  options?: { suppressResponse?: boolean; willContinue?: boolean };
};
export type TalkAcknowledgeMarkPayload = TalkRelayIdPayload & { markName: string };
export type TalkStartAgentConsultPayload = TalkRelayIdPayload & {
  sessionKey: string;
  callId: string;
  args: Record<string, unknown>;
};
export type TalkOperationResult = { ok: true };
export type TalkAgentConsultResult = { runId: string; text: string };
