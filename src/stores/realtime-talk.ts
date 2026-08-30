import { create } from 'zustand';
import type { TalkTerminalReason } from '@shared/talk/types';

let activeRelayCleanup: (() => Promise<void>) | null = null;
let relayCloseInFlight: Promise<void> | null = null;

// ACP owns reload boundaries, but the controller owns the browser resources it must release.
export function registerRealtimeTalkCleanup(cleanup: () => Promise<void>): () => void {
  activeRelayCleanup = cleanup;
  return () => {
    if (activeRelayCleanup === cleanup) activeRelayCleanup = null;
  };
}

export async function stopActiveRealtimeTalk(): Promise<void> {
  await activeRelayCleanup?.();
}

export function isRealtimeTalkCloseInFlight(): boolean {
  return relayCloseInFlight !== null;
}

export function retainRealtimeTalkReservationUntil(close: Promise<void>): void {
  relayCloseInFlight = close;
  void close.then(
    () => {
      if (relayCloseInFlight === close) relayCloseInFlight = null;
    },
    () => {
      if (relayCloseInFlight === close) relayCloseInFlight = null;
    },
  );
}

export type RealtimeTalkStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'disconnected' | 'error';

export type LiveTalkTranscript = {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
};

type TalkConversationState = {
  userIndex: number | null;
  userAwaitingFinal: boolean;
  assistantIndex: number | null;
  assistantSegmentPrefix: string;
  assistantSegmentText: string;
};

type RealtimeTalkState = {
  status: RealtimeTalkStatus;
  relaySessionId: string | null;
  sessionKey: string | null;
  inputLevel: number;
  transcripts: LiveTalkTranscript[];
  conversation: TalkConversationState;
  error: string | null;
  consultRefreshError: string | null;
  consultRefreshRetrying: boolean;
  isActive: boolean;
  reserve: (sessionKey: string) => boolean;
  begin: (relaySessionId: string, sessionKey: string) => void;
  setStatus: (status: RealtimeTalkStatus) => void;
  setInputLevel: (inputLevel: number) => void;
  appendTranscript: (entry: LiveTalkTranscript) => void;
  clearTranscripts: () => void;
  setConsultRefreshFailure: (error: string) => void;
  setConsultRefreshRetrying: (retrying: boolean) => void;
  clearConsultRefreshFailure: () => void;
  finish: (reason: TalkTerminalReason, error?: string) => void;
  reset: () => void;
};

const MAX_TRANSCRIPT_ENTRIES = 60;
const MAX_ACTIVE_TRANSCRIPT_TEXT_LENGTH = 4_000;

function createTalkConversationState(): TalkConversationState {
  return {
    userIndex: null,
    userAwaitingFinal: false,
    assistantIndex: null,
    assistantSegmentPrefix: '',
    assistantSegmentText: '',
  };
}

function isCjkCharacter(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function shouldInsertTranscriptSpace(existing: string, incoming: string): boolean {
  const last = existing.at(-1);
  const first = incoming[0];
  if (!last || !first || /\s/.test(last) || /\s/.test(first) || (isCjkCharacter(last) && isCjkCharacter(first))) return false;
  return /[\p{L}\p{N}.!?,:;)\]}"'’”]/u.test(last) && /[\p{L}\p{N}]/u.test(first);
}

function assistantSegmentPrefix(existing: string, incoming: string): string {
  if (existing.trim() === '') return '';
  const leadingWhitespace = incoming.match(/^\s+/u)?.[0] ?? '';
  const trimmedIncoming = incoming.slice(leadingWhitespace.length);
  const separator = leadingWhitespace || (shouldInsertTranscriptSpace(existing, trimmedIncoming) ? ' ' : '');
  return `${existing}${separator}`;
}

function boundActiveTranscriptText(text: string, final: boolean): string {
  if (!final) return text.slice(0, MAX_ACTIVE_TRANSCRIPT_TEXT_LENGTH);
  return text;
}

function finalizeTranscript(transcripts: LiveTalkTranscript[], index: number | null): LiveTalkTranscript[] {
  if (index === null || transcripts[index]?.final) return transcripts;
  return transcripts.map((entry, candidateIndex) => candidateIndex === index ? { ...entry, final: true } : entry);
}

function appendTranscriptEntry(
  transcripts: LiveTalkTranscript[],
  conversation: TalkConversationState,
  entry: LiveTalkTranscript,
): { transcripts: LiveTalkTranscript[]; conversation: TalkConversationState; index: number } {
  const overflow = Math.max(0, transcripts.length + 1 - MAX_TRANSCRIPT_ENTRIES);
  const nextIndex = transcripts.length - overflow;
  const shiftIndex = (index: number | null) => index === null ? null : index < overflow ? null : index - overflow;
  const assistantIndex = shiftIndex(conversation.assistantIndex);
  return {
    transcripts: [...transcripts, entry].slice(overflow),
    conversation: {
      userIndex: shiftIndex(conversation.userIndex),
      userAwaitingFinal: shiftIndex(conversation.userIndex) === null ? false : conversation.userAwaitingFinal,
      assistantIndex,
      assistantSegmentPrefix: assistantIndex === null ? '' : conversation.assistantSegmentPrefix,
      assistantSegmentText: assistantIndex === null ? '' : conversation.assistantSegmentText,
    },
    index: nextIndex,
  };
}

function reduceTranscript(
  transcripts: LiveTalkTranscript[],
  conversation: TalkConversationState,
  entry: LiveTalkTranscript,
): { transcripts: LiveTalkTranscript[]; conversation: TalkConversationState } {
  if (entry.final ? entry.text.trim() === '' : entry.text === '') return { transcripts, conversation };
  let nextTranscripts = transcripts;
  let nextConversation = conversation;

  if (entry.role === 'assistant') {
    const userWasForcedFinal = nextConversation.userIndex !== null
      && !nextTranscripts[nextConversation.userIndex]?.final;
    nextTranscripts = finalizeTranscript(nextTranscripts, nextConversation.userIndex);
    nextConversation = {
      ...nextConversation,
      userAwaitingFinal: userWasForcedFinal || nextConversation.userAwaitingFinal,
    };
    if (nextConversation.assistantIndex === null) {
      const text = boundActiveTranscriptText(entry.text, entry.final);
      const appended = appendTranscriptEntry(nextTranscripts, nextConversation, {
        ...entry,
        text,
      });
      return {
        transcripts: appended.transcripts,
        conversation: {
          ...appended.conversation,
          assistantIndex: appended.index,
          assistantSegmentPrefix: '',
          assistantSegmentText: text,
        },
      };
    }
    const index = nextConversation.assistantIndex;
    const existing = nextTranscripts[index];
    if (!existing) {
      return {
        transcripts: nextTranscripts,
        conversation: {
          ...nextConversation,
          assistantIndex: null,
          assistantSegmentPrefix: '',
          assistantSegmentText: '',
        },
      };
    }
    let prefix = nextConversation.assistantSegmentPrefix;
    let segment = nextConversation.assistantSegmentText;
    let incoming = entry.text;
    if (existing.final) {
      prefix = assistantSegmentPrefix(existing.text, entry.text);
      segment = '';
      incoming = entry.text.trimStart();
    }
    const nextSegment = entry.final ? incoming : `${segment}${incoming}`;
    const boundedSegment = boundActiveTranscriptText(nextSegment, entry.final);
    const text = `${prefix}${boundedSegment}`;
    return {
      transcripts: nextTranscripts.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, text, final: entry.final } : candidate),
      conversation: {
        ...nextConversation,
        assistantSegmentPrefix: prefix,
        assistantSegmentText: boundedSegment,
      },
    };
  }

  const userIndex = nextConversation.userIndex;
  const existingUser = userIndex === null ? undefined : nextTranscripts[userIndex];
  const existingAssistant = nextConversation.assistantIndex === null
    ? undefined
    : nextTranscripts[nextConversation.assistantIndex];
  const continuesInterruptedUser = nextConversation.assistantIndex !== null
    && existingUser !== undefined
    && nextConversation.userAwaitingFinal
    && (entry.final || existingAssistant?.final === false);

  if (nextConversation.assistantIndex !== null && !continuesInterruptedUser) {
    nextTranscripts = finalizeTranscript(nextTranscripts, nextConversation.assistantIndex);
    nextConversation = createTalkConversationState();
  }
  if (nextConversation.userIndex === null) {
    const appended = appendTranscriptEntry(nextTranscripts, nextConversation, {
      ...entry,
      text: boundActiveTranscriptText(entry.text, entry.final),
    });
    return {
      transcripts: appended.transcripts,
      conversation: { ...appended.conversation, userIndex: appended.index },
    };
  }

  const index = nextConversation.userIndex;
  const existing = nextTranscripts[index];
  if (!existing) return { transcripts: nextTranscripts, conversation: createTalkConversationState() };
  const text = boundActiveTranscriptText(entry.final ? entry.text : `${existing.text}${entry.text}`, entry.final);
  return {
    transcripts: nextTranscripts.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, text, final: entry.final } : candidate),
    conversation: {
      ...nextConversation,
      userAwaitingFinal: entry.final ? false : nextConversation.userAwaitingFinal,
    },
  };
}

const initialState = {
  status: 'idle' as const,
  relaySessionId: null,
  sessionKey: null,
  inputLevel: 0,
  transcripts: [] as LiveTalkTranscript[],
  conversation: createTalkConversationState(),
  error: null,
  consultRefreshError: null,
  consultRefreshRetrying: false,
  isActive: false,
};

export const useRealtimeTalkStore = create<RealtimeTalkState>((set) => ({
  ...initialState,
  reserve: (sessionKey) => {
    let reserved = false;
    set((state) => {
      if (state.isActive) return {};
      reserved = true;
      return {
        status: 'connecting',
        sessionKey,
        relaySessionId: null,
        inputLevel: 0,
        transcripts: [],
        conversation: createTalkConversationState(),
        error: null,
        consultRefreshError: null,
        consultRefreshRetrying: false,
        isActive: true,
      };
    });
    return reserved;
  },
  begin: (relaySessionId, sessionKey) => set({
    relaySessionId,
    sessionKey,
    status: 'listening',
    error: null,
    inputLevel: 0,
    transcripts: [],
    conversation: createTalkConversationState(),
    isActive: true,
  }),
  setStatus: (status) => set({ status }),
  setInputLevel: (inputLevel) => set({ inputLevel: Math.max(0, Math.min(1, inputLevel)) }),
  appendTranscript: (entry) => set((state) => reduceTranscript(state.transcripts, state.conversation, entry)),
  clearTranscripts: () => set({ transcripts: [], conversation: createTalkConversationState() }),
  setConsultRefreshFailure: (error) => set({ consultRefreshError: error, consultRefreshRetrying: false }),
  setConsultRefreshRetrying: (consultRefreshRetrying) => set({ consultRefreshRetrying }),
  clearConsultRefreshFailure: () => set({ consultRefreshError: null, consultRefreshRetrying: false }),
  finish: (reason, error) => set({
    ...initialState,
    status: error ? 'error' : reason === 'disconnected' ? 'disconnected' : 'idle',
    error: error ?? null,
  }),
  reset: () => set(initialState),
}));
