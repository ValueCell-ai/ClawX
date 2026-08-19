import type { TalkCatalog, TalkRelayEvent, TalkRelaySession } from '@shared/talk/types';
import { DEFAULT_SESSION_KEY, type ChatSession } from '@shared/chat/types';
import type { GatewayStatus } from '@shared/types/gateway';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { useAcpChatSessionStore } from '@/stores/acp-chat-session';
import { useChatStore } from '@/stores/chat';
import { isOpenClawHeartbeatOnlySession } from '@/stores/chat/session-key-utils';
import {
  isRealtimeTalkCloseInFlight,
  registerRealtimeTalkCleanup,
  retainRealtimeTalkReservationUntil,
  useRealtimeTalkStore,
} from '@/stores/realtime-talk';
import {
  decodePcm16Base64,
  float32ToPcm16,
  inputLevel,
  Pcm16PlaybackQueue,
  pcm16ToBase64,
  StreamingResampler,
} from './audio';
import { createMicrophoneBridge, type MicrophoneBridge } from './audio-worklet';

type TalkApi = Pick<typeof hostApi.talk,
  'startRelay' | 'appendAudio' | 'cancelOutput' | 'acknowledgeMark' | 'stopRelay' | 'startAgentConsult' | 'submitToolResult'>;

type TalkAudioTransport = {
  start: (
    onSamples: (samples: Float32Array, sampleRateHz: number) => void,
    inputSampleRateHz: number,
  ) => Promise<void>;
  stop: () => void;
  enqueueOutput: (samples: Int16Array, sampleRate: number) => Promise<void>;
  clearOutput: () => void;
};

type ControllerDependencies = {
  talk: TalkApi;
  subscribeTalk: (listener: (event: TalkRelayEvent) => void) => () => void;
  subscribeGatewayStatus: (listener: (status: GatewayStatus) => void) => () => void;
  createAudio: () => TalkAudioTransport;
  getAcpState: () => { sending: boolean; activeSessionKey: string | null };
  // Dependency injection keeps unit tests deterministic; validation remains in the controller.
  getSelectedSession: (sessionKey: string) => ChatSession | null;
  reloadAcpSession: () => Promise<boolean>;
};

type StartInput = { sessionKey: string; heartbeatOnly?: boolean };
type StartAttempt = { generation: number };
type Consult = {
  callId: string;
  relaySessionId: string;
  relayGeneration: number;
  cancelled: boolean;
  operationSettled: boolean;
  submissionCompleted: boolean;
  finalReceived: boolean;
  providerAudioObserved: boolean;
  postAudioPlaybackCompleted: boolean;
  outputBoundaryConsumed: boolean;
  refreshingAcp: boolean;
};

const MAX_PENDING_TALK_EVENTS = 32;

function isTerminalTalkEvent(event: TalkRelayEvent): boolean {
  return event.type === 'close' || event.type === 'error';
}

function isFinalToolResult(event: Extract<TalkRelayEvent, { type: 'toolResult' }>): boolean {
  const talkEvent = event.talkEvent;
  if (!talkEvent || typeof talkEvent !== 'object') return true;
  const raw = talkEvent as { type?: unknown; final?: unknown };
  return raw.type !== 'tool.progress' && !(raw.type === 'tool.result' && raw.final === false);
}

function isSupportedSampleRate(sampleRateHz: number): boolean {
  return Number.isInteger(sampleRateHz) && sampleRateHz >= 8_000 && sampleRateHz <= 192_000;
}

function isSupportedAudio(session: TalkRelaySession): boolean {
  const { audio } = session;
  return audio.inputEncoding === 'pcm16'
    && audio.outputEncoding === 'pcm16'
    && isSupportedSampleRate(audio.inputSampleRateHz)
    && isSupportedSampleRate(audio.outputSampleRateHz);
}

class BrowserTalkAudioTransport implements TalkAudioTransport {
  private context: AudioContext | null = null;
  private microphone: MicrophoneBridge | null = null;
  private playback: Pcm16PlaybackQueue | null = null;

  async start(
    onSamples: (samples: Float32Array, sampleRateHz: number) => void,
    inputSampleRateHz: number,
  ): Promise<void> {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) throw new Error('Realtime audio is not supported');
    this.context = new AudioContextConstructor({ sampleRate: inputSampleRateHz });
    this.playback = new Pcm16PlaybackQueue(this.context);
    this.microphone = await createMicrophoneBridge(this.context, (samples) => {
      onSamples(samples, this.context?.sampleRate ?? 0);
    });
    if (this.context.state === 'suspended') await this.context.resume();
  }

  stop(): void {
    this.microphone?.stop();
    this.microphone = null;
    this.playback?.clear();
    this.playback = null;
    void this.context?.close();
    this.context = null;
  }

  enqueueOutput(samples: Int16Array, sampleRate: number): Promise<void> {
    if (!this.playback) return Promise.reject(new Error('Talk playback is unavailable'));
    return this.playback.enqueue(samples, sampleRate);
  }

  clearOutput(): void {
    this.playback?.clear();
  }
}

export class RealtimeTalkController {
  private relaySessionId: string | null = null;
  private sessionKey: string | null = null;
  private unsubscribeTalk: (() => void) | null = null;
  private unsubscribeGateway: (() => void) | null = null;
  private unregisterCleanup: (() => void) | null = null;
  private audio: TalkAudioTransport | null = null;
  private startGeneration = 0;
  private relayGeneration = 0;
  private appendQueue = Promise.resolve();
  private queuedAppendCount = 0;
  private inputSampleRateHz = 24_000;
  private outputSampleRateHz = 24_000;
  private resampler: StreamingResampler | null = null;
  private captureSampleRateHz: number | null = null;
  private outputGeneration = 0;
  private outputTurnActive = false;
  private outputCancelled = false;
  private outputCompletions = new Set<Promise<void>>();
  // Relay marks do not carry tool-call identity, so one consult owns the audio/mark sequence at a time.
  private activeConsult: Consult | null = null;
  private pendingConsults: Extract<TalkRelayEvent, { type: 'toolCall' }>[] = [];
  private handledToolCallIds = new Set<string>();
  private markQueue = Promise.resolve();
  private consultRefreshInFlight: Promise<boolean> | null = null;
  private failedConsultRefresh: Consult | null = null;
  private cleanupInFlight: Promise<void> | null = null;
  private outputBoundaryInFlight: Promise<void> | null = null;
  private completedCloseInFlight: Promise<void> | null = null;

  constructor(private readonly dependencies: ControllerDependencies) {}

  async start(input: StartInput): Promise<boolean> {
    if (useRealtimeTalkStore.getState().isActive || isRealtimeTalkCloseInFlight()) return false;
    const sessionKey = input.sessionKey.trim();
    const acp = this.dependencies.getAcpState();
    const selectedSession = this.dependencies.getSelectedSession(sessionKey);
    if (
      !sessionKey
      || sessionKey === DEFAULT_SESSION_KEY
      || sessionKey !== acp.activeSessionKey
      || !selectedSession
      || selectedSession.key !== sessionKey
      || isOpenClawHeartbeatOnlySession(selectedSession)
      || input.heartbeatOnly
      || acp.sending
    ) {
      useRealtimeTalkStore.getState().finish('error', acp.sending
        ? 'An ACP prompt is already in progress'
        : 'Talk requires the selected non-heartbeat session');
      return false;
    }
    if (!useRealtimeTalkStore.getState().reserve(sessionKey)) return false;

    const attempt: StartAttempt = { generation: this.startGeneration += 1 };
    this.unregisterCleanup = registerRealtimeTalkCleanup(() => this.stop());
    let relay: TalkRelaySession | null = null;
    let audio: TalkAudioTransport | null = null;
    let unsubscribeTalk: (() => void) | null = null;
    let unsubscribeGateway: (() => void) | null = null;
    const pendingTalkEvents: TalkRelayEvent[] = [];
    try {
      unsubscribeTalk = this.dependencies.subscribeTalk((event) => {
        if (this.relaySessionId) {
          this.handleEvent(event);
          return;
        }
        if (pendingTalkEvents.length >= MAX_PENDING_TALK_EVENTS) {
          const nonTerminalIndex = pendingTalkEvents.findIndex((pending) => !isTerminalTalkEvent(pending));
          pendingTalkEvents.splice(nonTerminalIndex >= 0 ? nonTerminalIndex : 0, 1);
        }
        pendingTalkEvents.push(event);
      });
      relay = await this.dependencies.talk.startRelay({ sessionKey });
      if (!this.isCurrentAttempt(attempt)) {
        unsubscribeTalk?.();
        unsubscribeTalk = null;
        await this.closeRelayWithReservation(relay.relaySessionId);
        return false;
      }
      if (!isSupportedAudio(relay)) throw new Error('Unsupported Talk audio contract');
      const relaySessionId = relay.relaySessionId;

      this.relaySessionId = relaySessionId;
      this.sessionKey = sessionKey;
      this.relayGeneration += 1;
      this.inputSampleRateHz = relay.audio.inputSampleRateHz;
      this.outputSampleRateHz = relay.audio.outputSampleRateHz;
      this.unsubscribeTalk = unsubscribeTalk;
      unsubscribeTalk = null;

      const relayEvents = pendingTalkEvents.filter((event) => event.relaySessionId === relaySessionId);
      const terminalEvent = relayEvents.find(isTerminalTalkEvent);
      if (terminalEvent) {
        this.handleEvent(terminalEvent);
        await this.cleanupInFlight;
        return false;
      }

      audio = this.dependencies.createAudio();
      this.audio = audio;
      audio = null;
      unsubscribeGateway = this.dependencies.subscribeGatewayStatus((status) => {
        if (status.state !== 'running' || status.gatewayReady === false) void this.handleGatewayDisconnect();
      });
      this.unsubscribeGateway = unsubscribeGateway;
      unsubscribeGateway = null;
      await this.audio.start(
        (samples, sampleRateHz) => this.handleInput(samples, sampleRateHz),
        this.inputSampleRateHz,
      );
      if (!this.isCurrentAttempt(attempt)) {
        await this.cleanupInFlight;
        return false;
      }
      const latestAcp = this.dependencies.getAcpState();
      const latestSelectedSession = this.dependencies.getSelectedSession(sessionKey);
      if (
        !this.isCurrentAttempt(attempt)
        || latestAcp.sending
        || latestAcp.activeSessionKey !== sessionKey
        || !latestSelectedSession
        || latestSelectedSession.key !== sessionKey
        || isOpenClawHeartbeatOnlySession(latestSelectedSession)
      ) throw new Error('ACP session changed during Talk startup');

      useRealtimeTalkStore.getState().begin(relay.relaySessionId, sessionKey);
      for (const event of relayEvents) {
        if (!isTerminalTalkEvent(event)) this.handleEvent(event);
      }
      return true;
    } catch (error) {
      unsubscribeTalk?.();
      unsubscribeGateway?.();
      audio?.stop();
      if (relay && this.relaySessionId === relay.relaySessionId) this.releaseLocalResources();
      if (relay) await this.closeRelayWithReservation(relay.relaySessionId);
      if (this.isCurrentAttempt(attempt)) {
        this.unregisterCleanup?.();
        this.unregisterCleanup = null;
        useRealtimeTalkStore.getState().finish('error', error instanceof Error ? error.message : 'Talk could not start');
      }
      return false;
    }
  }

  async stop(): Promise<void> {
    await this.cleanup('cancelled');
  }

  async catalog(): Promise<TalkCatalog> {
    return await hostApi.talk.catalog();
  }

  async handleSessionChange(sessionKey: string): Promise<void> {
    const reservedSessionKey = useRealtimeTalkStore.getState().sessionKey;
    if (reservedSessionKey && reservedSessionKey !== sessionKey) await this.cleanup('cancelled');
  }

  async handleGatewayDisconnect(): Promise<void> {
    await this.cleanup('disconnected');
  }

  private isCurrentAttempt(attempt: StartAttempt): boolean {
    return this.startGeneration === attempt.generation;
  }

  private handleInput(samples: Float32Array, captureSampleRateHz: number): void {
    const relaySessionId = this.relaySessionId;
    if (!relaySessionId) return;
    const level = inputLevel(samples);
    useRealtimeTalkStore.getState().setInputLevel(level);
    if (this.outputTurnActive && !this.outputCancelled && level >= 0.05) {
      this.outputCancelled = true;
      this.audio?.clearOutput();
      void this.dependencies.talk.cancelOutput({ relaySessionId }).catch(() => undefined);
    }
    if (this.queuedAppendCount >= 4) return;
    try {
      if (!this.resampler) {
        this.resampler = new StreamingResampler(captureSampleRateHz, this.inputSampleRateHz);
        this.captureSampleRateHz = captureSampleRateHz;
      } else if (this.captureSampleRateHz !== captureSampleRateHz) {
        throw new Error('Talk microphone sample rate changed');
      }
    } catch (error) {
      void this.cleanup('error', error instanceof Error ? error.message : 'Unsupported Talk audio sample rate');
      return;
    }
    const resampled = this.resampler.process(samples);
    if (resampled.length === 0) return;
    this.queuedAppendCount += 1;
    const audioBase64 = pcm16ToBase64(float32ToPcm16(resampled));
    const append = this.appendQueue.then(async () => {
      if (this.relaySessionId !== relaySessionId) return;
      await this.dependencies.talk.appendAudio({ relaySessionId, audioBase64, timestamp: Date.now() });
    });
    this.appendQueue = append
      .catch((error) => {
        if (this.relaySessionId === relaySessionId) {
          void this.cleanup('error', error instanceof Error ? error.message : 'Talk audio upload failed');
        }
      })
      .finally(() => { this.queuedAppendCount = Math.max(0, this.queuedAppendCount - 1); });
  }

  private handleEvent(event: TalkRelayEvent): void {
    if (event.relaySessionId !== this.relaySessionId) return;
    switch (event.type) {
      case 'ready':
        useRealtimeTalkStore.getState().setStatus('listening');
        break;
      case 'transcript':
        useRealtimeTalkStore.getState().appendTranscript(event);
        break;
      case 'audio':
        this.playOutput(event.audioBase64);
        break;
      case 'audioDone':
        this.completeOutputTurn();
        break;
      case 'clear':
        this.clearOutputTurn();
        useRealtimeTalkStore.getState().setStatus('listening');
        break;
      case 'mark':
        this.completeOutputTurn(event.markName);
        break;
      case 'toolCall':
        if (event.name === 'openclaw_agent_consult') this.enqueueAgentConsult(event);
        break;
      case 'toolResult':
        this.completeAgentConsult(event.callId, isFinalToolResult(event));
        break;
      case 'toolCallCancelled':
        this.cancelAgentConsult(event.callId);
        break;
      case 'error':
        void this.cleanup('error', event.message);
        break;
      case 'close':
        if (event.reason === 'completed' && this.hasClaimedProviderAudio()) {
          if (!this.outputBoundaryInFlight) this.completeOutputTurn();
          void this.deferCompletedClose();
        } else {
          void this.cleanup(event.reason, event.reason === 'error' ? 'Talk relay closed with an error' : undefined);
        }
        break;
    }
  }

  private playOutput(audioBase64: string): void {
    const relaySessionId = this.relaySessionId;
    if (!relaySessionId || !this.audio || this.outputCancelled) return;
    let samples: Int16Array;
    try {
      samples = decodePcm16Base64(audioBase64);
    } catch (error) {
      void this.cleanup('error', error instanceof Error ? error.message : 'Invalid Talk audio');
      return;
    }
    if (!this.outputTurnActive) {
      this.outputTurnActive = true;
      this.outputGeneration += 1;
      useRealtimeTalkStore.getState().setStatus('speaking');
    }
    const generation = this.outputGeneration;
    let completion: Promise<void>;
    try {
      completion = this.audio.enqueueOutput(samples, this.outputSampleRateHz);
    } catch (error) {
      void this.cleanup('error', error instanceof Error ? error.message : 'Talk playback failed');
      return;
    }
    this.observeProviderAudio();
    this.outputCompletions.add(completion);
    void completion
      .then(() => undefined)
      .catch((error) => {
        if (this.isCurrentOutputTurn(generation, relaySessionId)) {
          void this.cleanup('error', error instanceof Error ? error.message : 'Talk playback failed');
        }
      })
      .finally(() => this.outputCompletions.delete(completion));
  }

  private completeOutputTurn(markName?: string): void {
    const relaySessionId = this.relaySessionId;
    const generation = this.outputGeneration;
    const hadOutput = this.outputTurnActive;
    if (!relaySessionId) return;
    const completions = [...this.outputCompletions];
    this.markQueue = this.markQueue
      .then(async () => {
        await Promise.all(completions);
        if (this.relaySessionId !== relaySessionId) return;
        if (markName) await this.acknowledgeMark(markName);
        if (this.relaySessionId !== relaySessionId) return;
        if (hadOutput) {
          if (!this.isCurrentOutputTurn(generation, relaySessionId) || this.outputCancelled) return;
          this.outputTurnActive = false;
          useRealtimeTalkStore.getState().setStatus('listening');
        } else {
          useRealtimeTalkStore.getState().setStatus('listening');
        }
        if (hadOutput) await this.completeProviderOutputBoundary();
      })
      .catch(() => undefined);
    if (hadOutput) {
      const boundary = this.markQueue;
      this.outputBoundaryInFlight = boundary;
      void boundary.finally(() => {
        if (this.outputBoundaryInFlight === boundary) this.outputBoundaryInFlight = null;
      });
    }
  }

  private isCurrentOutputTurn(generation: number, relaySessionId: string): boolean {
    return this.outputTurnActive
      && this.outputGeneration === generation
      && this.relaySessionId === relaySessionId;
  }

  private clearOutputTurn(): void {
    this.outputGeneration += 1;
    this.outputTurnActive = false;
    this.outputCancelled = false;
    this.outputCompletions.clear();
    this.audio?.clearOutput();
  }

  private async acknowledgeMark(markName: string): Promise<void> {
    const relaySessionId = this.relaySessionId;
    if (!relaySessionId) return;
    await this.dependencies.talk.acknowledgeMark({ relaySessionId, markName }).catch(() => undefined);
  }

  private isCurrentConsult(consult: Consult): boolean {
    return this.relaySessionId === consult.relaySessionId
      && this.relayGeneration === consult.relayGeneration
      && this.activeConsult === consult;
  }

  private enqueueAgentConsult(event: Extract<TalkRelayEvent, { type: 'toolCall' }>): void {
    if (!this.relaySessionId || !this.sessionKey || this.handledToolCallIds.has(event.callId)) return;
    this.handledToolCallIds.add(event.callId);
    this.pendingConsults.push(event);
    this.startNextAgentConsult();
  }

  private cancelAgentConsult(callId: string): void {
    this.pendingConsults = this.pendingConsults.filter((consult) => consult.callId !== callId);
    if (this.activeConsult?.callId !== callId) return;
    this.activeConsult.cancelled = true;
    this.failedConsultRefresh = null;
    useRealtimeTalkStore.getState().clearConsultRefreshFailure();
    this.releaseCancelledConsult(this.activeConsult);
  }

  private releaseCancelledConsult(consult: Consult): void {
    if (!this.isCurrentConsult(consult) || !consult.cancelled || !consult.operationSettled) return;
    this.activeConsult = null;
    this.startNextAgentConsult();
  }

  private startNextAgentConsult(): void {
    if (this.activeConsult || this.consultRefreshInFlight) return;
    const event = this.pendingConsults.shift();
    if (event) void this.startAgentConsult(event);
  }

  private async startAgentConsult(event: Extract<TalkRelayEvent, { type: 'toolCall' }>): Promise<void> {
    const relaySessionId = this.relaySessionId;
    const sessionKey = this.sessionKey;
    if (!relaySessionId || !sessionKey || this.activeConsult) return;
    const consult: Consult = {
      callId: event.callId,
      relaySessionId,
      relayGeneration: this.relayGeneration,
      cancelled: false,
      operationSettled: false,
      submissionCompleted: false,
      finalReceived: false,
      providerAudioObserved: false,
      postAudioPlaybackCompleted: false,
      outputBoundaryConsumed: false,
      refreshingAcp: false,
    };
    this.activeConsult = consult;
    useRealtimeTalkStore.getState().setStatus('thinking');
    try {
      const result = await this.dependencies.talk.startAgentConsult({ relaySessionId, sessionKey, callId: event.callId, args: event.args });
      if (!this.isCurrentConsult(consult) || consult.cancelled) return;
      if (!result.text.trim()) throw new Error('Agent consult completed without text');
      await this.dependencies.talk.submitToolResult({
        relaySessionId,
        callId: event.callId,
        result: result.text,
      });
      if (!this.isCurrentConsult(consult) || consult.cancelled) return;
      consult.submissionCompleted = true;
      this.refreshConsultWhenReady(consult);
    } catch (error) {
      if (!this.isCurrentConsult(consult) || consult.cancelled) return;
      this.activeConsult = null;
      await this.cleanup('error', error instanceof Error ? error.message : 'Agent consult failed');
    } finally {
      consult.operationSettled = true;
      this.releaseCancelledConsult(consult);
    }
  }

  private completeAgentConsult(callId: string, final: boolean): void {
    const consult = this.activeConsult;
    if (!final || !consult || !this.isCurrentConsult(consult)) return;
    if (consult.callId !== callId) return;
    consult.finalReceived = true;
    this.refreshConsultWhenReady(consult);
  }

  private observeProviderAudio(): void {
    const consult = this.activeConsult;
    if (!consult || !this.isCurrentConsult(consult) || consult.cancelled || consult.outputBoundaryConsumed) return;
    consult.providerAudioObserved = true;
    this.refreshConsultWhenReady(consult);
  }

  private hasClaimedProviderAudio(): boolean {
    const consult = this.activeConsult;
    return Boolean(consult && this.isCurrentConsult(consult) && !consult.cancelled && consult.providerAudioObserved);
  }

  private async completeProviderOutputBoundary(): Promise<void> {
    const consult = this.activeConsult;
    if (!consult || !this.isCurrentConsult(consult) || consult.cancelled || !consult.providerAudioObserved || consult.outputBoundaryConsumed) return;
    consult.postAudioPlaybackCompleted = true;
    await this.refreshConsultWhenReady(consult);
  }

  private refreshConsultWhenReady(consult: Consult): Promise<boolean> | undefined {
    if (
      !this.isCurrentConsult(consult)
      || consult.cancelled
      || !consult.submissionCompleted
      || !consult.finalReceived
      || !consult.providerAudioObserved
      || !consult.postAudioPlaybackCompleted
      || consult.outputBoundaryConsumed
      || consult.refreshingAcp
      || this.consultRefreshInFlight
    ) return undefined;
    // Consume this anonymous relay boundary before reloading so later marks cannot retry a failed refresh.
    consult.outputBoundaryConsumed = true;
    return this.refreshConsultAcp(consult, false);
  }

  async retryConsultRefresh(): Promise<boolean> {
    const consult = this.failedConsultRefresh;
    if (!consult || !this.isCurrentConsult(consult) || this.consultRefreshInFlight) return false;
    return await this.refreshConsultAcp(consult, true);
  }

  private async refreshConsultAcp(consult: Consult, retry: boolean): Promise<boolean> {
    if (!this.isCurrentConsult(consult) || consult.refreshingAcp || this.consultRefreshInFlight) return false;
    consult.refreshingAcp = true;
    this.failedConsultRefresh = null;
    if (retry) useRealtimeTalkStore.getState().setConsultRefreshRetrying(true);
    let refresh!: Promise<boolean>;
    refresh = (async () => {
      try {
        const reloaded = await this.dependencies.reloadAcpSession();
        if (!this.isCurrentConsult(consult)) return false;
        if (!reloaded) {
          consult.refreshingAcp = false;
          this.failedConsultRefresh = consult;
          useRealtimeTalkStore.getState().setConsultRefreshFailure('ACP session refresh failed');
          useRealtimeTalkStore.getState().setStatus('listening');
          return false;
        }
        useRealtimeTalkStore.getState().clearTranscripts();
        useRealtimeTalkStore.getState().clearConsultRefreshFailure();
        this.activeConsult = null;
        return true;
      } catch {
        if (!this.isCurrentConsult(consult)) return false;
        consult.refreshingAcp = false;
        this.failedConsultRefresh = consult;
        useRealtimeTalkStore.getState().setConsultRefreshFailure('ACP session refresh failed');
        useRealtimeTalkStore.getState().setStatus('listening');
        return false;
      } finally {
        if (this.consultRefreshInFlight === refresh) {
          this.consultRefreshInFlight = null;
          this.startNextAgentConsult();
        }
      }
    })();
    this.consultRefreshInFlight = refresh;
    return await refresh;
  }

  private async cleanup(reason: 'cancelled' | 'completed' | 'error' | 'disconnected' | (string & {}), error?: string): Promise<void> {
    if (this.cleanupInFlight) {
      await this.cleanupInFlight;
      return;
    }
    const cleanup = this.releaseAndClose(reason, error);
    this.cleanupInFlight = cleanup;
    try {
      await cleanup;
    } finally {
      if (this.cleanupInFlight === cleanup) this.cleanupInFlight = null;
    }
  }

  private async deferCompletedClose(): Promise<void> {
    if (this.completedCloseInFlight) {
      await this.completedCloseInFlight;
      return;
    }
    const relaySessionId = this.relaySessionId;
    const boundary = this.outputBoundaryInFlight;
    if (!relaySessionId || !boundary) {
      await this.cleanup('completed');
      return;
    }
    const deferred = (async () => {
      await boundary;
      if (this.relaySessionId !== relaySessionId) return;
      await this.consultRefreshInFlight;
      if (this.relaySessionId === relaySessionId) await this.cleanup('completed');
    })();
    this.completedCloseInFlight = deferred;
    try {
      await deferred;
    } finally {
      if (this.completedCloseInFlight === deferred) this.completedCloseInFlight = null;
    }
  }

  private async releaseAndClose(reason: 'cancelled' | 'completed' | 'error' | 'disconnected' | (string & {}), error?: string): Promise<void> {
    this.startGeneration += 1;
    this.relayGeneration += 1;
    const relaySessionId = this.relaySessionId;
    this.releaseLocalResources();
    useRealtimeTalkStore.getState().finish(reason, error);
    if (relaySessionId) await this.closeRelayWithReservation(relaySessionId);
  }

  private async closeRelayWithReservation(relaySessionId: string): Promise<void> {
    const close = this.closeRelay(relaySessionId);
    retainRealtimeTalkReservationUntil(close);
    await close;
  }

  private async closeRelay(relaySessionId: string): Promise<void> {
    await this.dependencies.talk.stopRelay({ relaySessionId }).catch(() => undefined);
  }

  private releaseLocalResources(): void {
    this.unregisterCleanup?.();
    this.unregisterCleanup = null;
    this.unsubscribeTalk?.();
    this.unsubscribeTalk = null;
    this.unsubscribeGateway?.();
    this.unsubscribeGateway = null;
    this.clearOutputTurn();
    this.audio?.stop();
    this.audio = null;
    this.relaySessionId = null;
    this.sessionKey = null;
    this.appendQueue = Promise.resolve();
    this.queuedAppendCount = 0;
    this.inputSampleRateHz = 24_000;
    this.outputSampleRateHz = 24_000;
    this.resampler = null;
    this.captureSampleRateHz = null;
    this.activeConsult = null;
    this.pendingConsults = [];
    this.handledToolCallIds.clear();
    this.markQueue = Promise.resolve();
    this.consultRefreshInFlight = null;
    this.failedConsultRefresh = null;
    this.outputBoundaryInFlight = null;
  }
}

export function createRealtimeTalkController(dependencies: ControllerDependencies): RealtimeTalkController {
  return new RealtimeTalkController(dependencies);
}

export const realtimeTalkController = createRealtimeTalkController({
  talk: hostApi.talk,
  subscribeTalk: hostEvents.onTalkEvent,
  subscribeGatewayStatus: hostEvents.onGatewayStatus,
  createAudio: () => new BrowserTalkAudioTransport(),
  getAcpState: () => {
    const state = useAcpChatSessionStore.getState();
    return { sending: state.sending, activeSessionKey: state.activeSessionKey };
  },
  getSelectedSession: (sessionKey) => (
    useChatStore.getState().sessions.find((session) => session.key === sessionKey) ?? null
  ),
  reloadAcpSession: () => useAcpChatSessionStore.getState().reloadActiveSession({ preserveRealtimeTalk: true }),
});
