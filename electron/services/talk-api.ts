import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayChatMessageEvent } from '@shared/host-events/contract';
import type {
  TalkCatalog,
  TalkCatalogProvider,
  TalkRelayEvent,
  TalkRealtimeSettingsPayload,
} from '@shared/talk/types';
import { mutateOpenClawConfig } from '../gateway/config-delivery';
import { isRecord } from './payload-utils';

export const TALK_RPC_TIMEOUT_MS = 8_000;
const AGENT_CONSULT_COMPLETION_TIMEOUT_MS = 120_000;
const MAX_PCM16_DECODED_BYTES = 2 * 1024 * 1024;

type PendingConsult = {
  relaySessionId: string;
  reject: (error: Error) => void;
};

export type ActiveTalkRelay = {
  relaySessionId: string;
  sessionKey: string;
};

export type TalkRelayOwnership = {
  activate: (relaySessionId: string, sessionKey: string) => void;
  clear: (relaySessionId?: string) => void;
  subscribeRelinquished: (listener: (relaySessionId: string) => void) => () => void;
  beginRelayStart: () => number;
  isRelayStartCurrent: (generation: number) => boolean;
  beginShutdown: () => ActiveTalkRelay | undefined;
  finishShutdown: () => void;
  getActive: () => ActiveTalkRelay | undefined;
  takeActive: () => ActiveTalkRelay | undefined;
  isActive: (relaySessionId: string) => boolean;
};

export function createTalkRelayOwnership(): TalkRelayOwnership {
  let active: ActiveTalkRelay | undefined;
  let generation = 0;
  let shuttingDown = false;
  const relinquishedListeners = new Set<(relaySessionId: string) => void>();
  const relinquish = (relay: ActiveTalkRelay | undefined): void => {
    if (!relay) return;
    for (const listener of relinquishedListeners) listener(relay.relaySessionId);
  };
  return {
    activate: (relaySessionId, sessionKey) => {
      if (active?.relaySessionId !== relaySessionId) relinquish(active);
      active = { relaySessionId, sessionKey };
    },
    clear: (relaySessionId) => {
      if (relaySessionId === undefined || active?.relaySessionId === relaySessionId) {
        const relinquished = active;
        active = undefined;
        relinquish(relinquished);
      }
    },
    subscribeRelinquished: (listener) => {
      relinquishedListeners.add(listener);
      return () => relinquishedListeners.delete(listener);
    },
    beginRelayStart: () => {
      if (shuttingDown) throw new Error('Talk relay startup was cancelled');
      return generation;
    },
    isRelayStartCurrent: (startGeneration) => !shuttingDown && generation === startGeneration,
    beginShutdown: () => {
      shuttingDown = true;
      generation += 1;
      const claimed = active;
      active = undefined;
      relinquish(claimed);
      return claimed;
    },
    finishShutdown: () => {
      shuttingDown = false;
    },
    getActive: () => active,
    takeActive: () => {
      const claimed = active;
      active = undefined;
      relinquish(claimed);
      return claimed;
    },
    isActive: (relaySessionId) => active?.relaySessionId === relaySessionId,
  };
}

export function forwardActiveTalkEvent(
  ownership: TalkRelayOwnership,
  event: TalkRelayEvent,
  sendToRenderer: (event: TalkRelayEvent) => void,
): void {
  if (!ownership.isActive(event.relaySessionId)) return;
  if (event.type === 'close') {
    ownership.clear(event.relaySessionId);
  }
  sendToRenderer(event);
}

type CloseWindowAfterActiveTalkDependencies = {
  ownership: TalkRelayOwnership;
  gatewayManager: GatewayManager;
  sendTalkEvent: (event: TalkRelayEvent) => void;
  hide: () => void;
  logWarn?: (message: string, error: unknown) => void;
  timeoutMs?: number;
};

export function closeWindowAfterActiveTalk({
  ownership,
  gatewayManager,
  sendTalkEvent,
  hide,
  logWarn,
  timeoutMs = TALK_RPC_TIMEOUT_MS,
}: CloseWindowAfterActiveTalkDependencies): void {
  const activeRelay = ownership.beginShutdown();
  if (!activeRelay) {
    ownership.finishShutdown();
    hide();
    return;
  }

  // This reaches the renderer through its typed Talk event subscription, releasing microphone tracks first.
  try {
    sendTalkEvent({ relaySessionId: activeRelay.relaySessionId, type: 'close', reason: 'cancelled' });
  } catch (error) {
    logWarn?.('Failed to request Talk renderer cleanup before hiding the window', error);
  }
  void (async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      gatewayManager.rpc('talk.session.close', { sessionId: activeRelay.relaySessionId }, TALK_RPC_TIMEOUT_MS)
        .then(() => ({ type: 'closed' as const }))
        .catch((error: unknown) => ({ type: 'failed' as const, error })),
      new Promise<{ type: 'timed-out' }>((resolve) => {
        timeout = setTimeout(() => resolve({ type: 'timed-out' }), timeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (result.type === 'failed') {
      logWarn?.('Failed to close active Talk relay before hiding the window', result.error);
    } else if (result.type === 'timed-out') {
      logWarn?.('Timed out closing active Talk relay before hiding the window', new Error(`Talk relay close exceeded ${timeoutMs}ms`));
    }
    ownership.finishShutdown();
    hide();
  })();
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function parseTalkCatalog(value: unknown): TalkCatalog {
  const catalog = isRecord(value) ? value : {};
  const realtime = isRecord(catalog.realtime) ? catalog.realtime : {};
  const providers: TalkCatalogProvider[] = Array.isArray(realtime.providers)
    ? realtime.providers.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return [];
      return [{
        id: value.id.trim(),
        label: typeof value.label === 'string' && value.label.trim() ? value.label.trim() : value.id.trim(),
        configured: value.configured === true,
        models: stringArray(value.models),
        ...(typeof value.defaultModel === 'string' && value.defaultModel.trim()
          ? { defaultModel: value.defaultModel.trim() }
          : {}),
        voices: stringArray(value.voices),
        transports: stringArray(value.transports),
        brains: stringArray(value.brains),
      }];
    })
    : [];
  const readiness = realtime.ready === true
    ? { ready: true as const }
    : realtime.ready === false
      ? {
        ready: false as const,
        ...(typeof realtime.reason === 'string' && realtime.reason.trim() ? { reason: realtime.reason.trim() } : {}),
      }
      : {};

  return {
    ...(Array.isArray(catalog.modes) ? { modes: stringArray(catalog.modes) } : {}),
    ...(Array.isArray(catalog.transports) ? { transports: stringArray(catalog.transports) } : {}),
    ...(Array.isArray(catalog.brains) ? { brains: stringArray(catalog.brains) } : {}),
    realtime: {
      ...readiness,
      ...(typeof realtime.activeProvider === 'string' && realtime.activeProvider.trim()
        ? { activeProvider: realtime.activeProvider.trim() }
        : {}),
      providers,
    },
  } as TalkCatalog;
}

function parseRealtimeSettings(value: unknown): TalkRealtimeSettingsPayload {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => key !== 'provider' && key !== 'model' && key !== 'speakerVoice')
  ) {
    throw new Error('Invalid Talk realtime settings');
  }
  const hasSpeakerVoice = Object.prototype.hasOwnProperty.call(value, 'speakerVoice');
  return {
    provider: requiredString(value.provider, 'Invalid Talk realtime provider'),
    model: requiredString(value.model, 'Invalid Talk realtime model'),
    ...(hasSpeakerVoice
      ? { speakerVoice: requiredString(value.speakerVoice, 'Invalid Talk realtime speaker voice') }
      : {}),
  };
}

function modelChoices(provider: TalkCatalogProvider): string[] {
  return provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
}

function validateRealtimeSettings(catalog: TalkCatalog, settings: TalkRealtimeSettingsPayload): boolean {
  const provider = catalog.realtime.providers.find((candidate) => candidate.id === settings.provider);
  if (!provider || !provider.configured) {
    throw new Error('Talk realtime provider is not available');
  }
  if (!modelChoices(provider).includes(settings.model)) {
    throw new Error('Talk realtime model is not available for the provider');
  }
  if (!provider.voices?.length) {
    if (settings.speakerVoice !== undefined) {
      throw new Error('Talk realtime speaker voice is not available for the provider');
    }
    return false;
  }
  if (!settings.speakerVoice || !provider.voices.includes(settings.speakerVoice)) {
    throw new Error('Talk realtime speaker voice is not available for the provider');
  }
  return true;
}

function updateRealtimeConfig(
  config: Record<string, unknown>,
  settings: TalkRealtimeSettingsPayload,
  updateSpeakerVoice: boolean,
): void {
  const talk = config.talk;
  if (talk !== undefined && !isRecord(talk)) {
    throw new Error('Invalid OpenClaw Talk config');
  }
  const nextTalk = talk ?? {};
  const realtime = nextTalk.realtime;
  if (realtime !== undefined && !isRecord(realtime)) {
    throw new Error('Invalid OpenClaw Talk realtime config');
  }
  const nextRealtime = realtime ?? {};
  nextRealtime.provider = settings.provider;
  nextRealtime.model = settings.model;
  if (updateSpeakerVoice) nextRealtime.speakerVoice = settings.speakerVoice;
  nextTalk.realtime = nextRealtime;
  config.talk = nextTalk;
}

async function validateRealtimeCatalogForMutation(
  gatewayManager: GatewayManager,
  settings: TalkRealtimeSettingsPayload,
): Promise<boolean> {
  if (gatewayManager.getStatus().state !== 'running') {
    throw new Error('Talk realtime catalog is unavailable; reconnect the Gateway and try again');
  }
  try {
    const catalog = parseTalkCatalog(await gatewayManager.rpc('talk.catalog', {}, TALK_RPC_TIMEOUT_MS));
    return validateRealtimeSettings(catalog, settings);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Talk realtime ')) throw error;
    throw new Error('Talk realtime catalog is unavailable; reconnect the Gateway and try again', { cause: error });
  }
}

function parseRelayId(value: unknown): string {
  return requiredString(value, 'Invalid Talk relay session id');
}

function requireActiveRelay(ownership: TalkRelayOwnership, relaySessionId: string): ActiveTalkRelay {
  const active = ownership.getActive();
  if (!active || active.relaySessionId !== relaySessionId) {
    throw new Error('Talk relay session is not active');
  }
  return active;
}

function parsePcm16Base64(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Invalid Talk PCM16 audio');
  }
  const paddingBytes = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - paddingBytes;
  if (decodedLength > MAX_PCM16_DECODED_BYTES) {
    throw new Error('Invalid Talk PCM16 audio');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length % 2 !== 0) {
    throw new Error('Invalid Talk PCM16 audio');
  }
  return value;
}

function parseTimestamp(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid Talk audio timestamp');
  }
  return Math.floor(value);
}

function parseToolResultOptions(value: unknown): { suppressResponse?: boolean; willContinue?: boolean } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || (value.suppressResponse !== undefined && typeof value.suppressResponse !== 'boolean')
    || (value.willContinue !== undefined && typeof value.willContinue !== 'boolean')) {
    throw new Error('Invalid Talk tool result options');
  }
  return {
    ...(typeof value.suppressResponse === 'boolean' ? { suppressResponse: value.suppressResponse } : {}),
    ...(typeof value.willContinue === 'boolean' ? { willContinue: value.willContinue } : {}),
  };
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string' ? [entry.text.trim()] : [])
      .filter(Boolean)
      .join('\n');
  }
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string' ? value.text.trim() : '';
}

function recordText(value: unknown): string {
  if (!isRecord(value)) return '';
  const direct = textFromContent(value.text) || textFromContent(value.content);
  if (direct) return direct;
  return textFromContent(value.message);
}

function completionText(value: unknown): string {
  if (!isRecord(value)) return '';
  return recordText(value)
    || recordText(value.message)
    || (isRecord(value.message) ? recordText(value.message.message) : '')
    || recordText(value.result)
    || (isRecord(value.result) ? recordText(value.result.message) : '');
}

function completionRunId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.runId === 'string' && value.runId.trim()) return value.runId.trim();
  return isRecord(value.message) && typeof value.message.runId === 'string' && value.message.runId.trim()
    ? value.message.runId.trim()
    : undefined;
}

function completionState(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const state = typeof value.state === 'string' ? value.state : typeof value.status === 'string' ? value.status : undefined;
  if (state?.trim()) return state.trim().toLowerCase();
  return isRecord(value.message) && typeof value.message.state === 'string' && value.message.state.trim()
    ? value.message.state.trim().toLowerCase()
    : undefined;
}

function terminalConsultError(state: string): Error | undefined {
  if (state === 'aborted' || state === 'cancelled' || state === 'canceled') {
    return new Error(`Agent consult run was ${state}`);
  }
  if (state === 'error' || state === 'failed') return new Error('Agent consult run failed');
  return undefined;
}

const EMPTY_FINAL_FALLBACK_GRACE_MS = 500;
const EMPTY_FINAL_FALLBACK_TEXT = 'OpenClaw finished with no text.';

function terminalAgentWaitError(value: unknown): Error | undefined {
  if (!isRecord(value)) return undefined;
  const status = typeof value.status === 'string' ? value.status : undefined;
  const message = typeof value.error === 'string' ? value.error.trim() : undefined;
  if (status === 'error') return new Error(message || 'Agent consult run failed');
  if (status !== 'timeout' || value.pendingError === true) return undefined;
  const stopReason = typeof value.stopReason === 'string' ? value.stopReason.trim() : undefined;
  const timeoutPhase = typeof value.timeoutPhase === 'string' ? value.timeoutPhase.trim() : undefined;
  const livenessState = typeof value.livenessState === 'string' ? value.livenessState.trim() : undefined;
  const terminal = value.endedAt !== undefined
    || message !== undefined
    || value.aborted === true
    || Boolean(livenessState)
    || value.yielded === true
    || Boolean(stopReason)
    || timeoutPhase === 'preflight'
    || timeoutPhase === 'provider'
    || timeoutPhase === 'post_turn'
    || value.providerStarted === true;
  return terminal ? new Error(message || 'Timed out waiting for Agent consult completion') : undefined;
}

export function createTalkApi(
  gatewayManager: GatewayManager,
  ownership: TalkRelayOwnership = createTalkRelayOwnership(),
): CompleteHostServiceRegistry['talk'] {
  let pendingRelayOperation = Promise.resolve();
  const pendingConsults = new Set<PendingConsult>();

  const rejectPendingConsults = (relaySessionId: string): void => {
    for (const consult of [...pendingConsults]) {
      if (consult.relaySessionId === relaySessionId) {
        consult.reject(new Error('Talk relay session is not active'));
      }
    }
  };

  const awaitAgentConsultCompletion = (
    relaySessionId: string,
    runId: string,
  ): Promise<{ runId: string; text: string }> => new Promise((resolve, reject) => {
    let settled = false;
    let fallbackStarted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeRelinquished: () => void = () => undefined;
    const pending: PendingConsult = { relaySessionId, reject: fail };

    function cleanup(): void {
      if (timer) clearTimeout(timer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      gatewayManager.off('chat:message', onChatMessage);
      pendingConsults.delete(pending);
      unsubscribeRelinquished();
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed(text: string): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ runId, text });
    }

    async function recoverEmptyFinal(): Promise<void> {
      try {
        const waited = await gatewayManager.rpc(
          'agent.wait',
          { runId, timeoutMs: AGENT_CONSULT_COMPLETION_TIMEOUT_MS },
          TALK_RPC_TIMEOUT_MS,
        );
        if (settled) return;
        const waitError = terminalAgentWaitError(waited);
        if (waitError) {
          fail(waitError);
          return;
        }
        if (completionState(waited) === 'timeout') return;
        fallbackTimer = setTimeout(() => succeed(EMPTY_FINAL_FALLBACK_TEXT), EMPTY_FINAL_FALLBACK_GRACE_MS);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Agent consult completion failed'));
      }
    }

    function onChatMessage(event: GatewayChatMessageEvent): void {
      if (completionRunId(event) !== runId) return;
      const state = completionState(event);
      if (!state) return;
      const error = terminalConsultError(state);
      if (error) {
        fail(error);
        return;
      }
      if (state !== 'final' && state !== 'completed') return;
      const text = completionText(event);
      if (text) {
        succeed(text);
      } else if (!fallbackStarted) {
        fallbackStarted = true;
        void recoverEmptyFinal();
      }
    }

    pendingConsults.add(pending);
    gatewayManager.on('chat:message', onChatMessage);
    unsubscribeRelinquished = ownership.subscribeRelinquished((relinquishedRelaySessionId) => {
      if (relinquishedRelaySessionId === relaySessionId) {
        fail(new Error('Talk relay session is not active'));
      }
    });
    if (!ownership.isActive(relaySessionId)) {
      fail(new Error('Talk relay session is not active'));
      return;
    }
    timer = setTimeout(
      () => fail(new Error('Timed out waiting for Agent consult completion')),
      AGENT_CONSULT_COMPLETION_TIMEOUT_MS,
    );
  });

  const serializeRelayOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousOperation = pendingRelayOperation;
    let releaseOperation!: () => void;
    pendingRelayOperation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    await previousOperation;
    try {
      return await operation();
    } finally {
      releaseOperation();
    }
  };

  return {
    catalog: async () => parseTalkCatalog(await gatewayManager.rpc('talk.catalog', {}, TALK_RPC_TIMEOUT_MS)),
    updateRealtimeSettings: async (payload) => {
      const settings = parseRealtimeSettings(payload);
      let updateSpeakerVoice = false;
      await mutateOpenClawConfig((config) => {
        updateRealtimeConfig(config, settings, updateSpeakerVoice);
      }, {
        beforeApply: async () => {
          updateSpeakerVoice = await validateRealtimeCatalogForMutation(gatewayManager, settings);
        },
      });
      return { ok: true };
    },
    startRelay: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const sessionKey = requiredString(body.sessionKey, 'Invalid Talk session key');
      const startGeneration = ownership.beginRelayStart();
      return await serializeRelayOperation(async () => {
        if (!ownership.isRelayStartCurrent(startGeneration)) {
          throw new Error('Talk relay startup was cancelled');
        }
        const activeRelay = ownership.getActive();
        if (activeRelay) {
          rejectPendingConsults(activeRelay.relaySessionId);
          try {
            await gatewayManager.rpc('talk.session.close', { sessionId: activeRelay.relaySessionId }, TALK_RPC_TIMEOUT_MS);
          } catch {
            // A failed replacement close must not leave global relay ownership locked forever.
          } finally {
            ownership.clear(activeRelay.relaySessionId);
          }
        }
        const relay = await gatewayManager.rpc('talk.session.create', {
          sessionKey,
          mode: 'realtime',
          transport: 'gateway-relay',
          brain: 'agent-consult',
        }, TALK_RPC_TIMEOUT_MS);
        if (!isRecord(relay)) {
          throw new Error('Invalid Talk relay session');
        }
        const relaySessionId = parseRelayId(relay.relaySessionId);
        if (!ownership.isRelayStartCurrent(startGeneration)) {
          try {
            await gatewayManager.rpc('talk.session.close', { sessionId: relaySessionId }, TALK_RPC_TIMEOUT_MS);
          } catch {
            // The relay is already invalidated by shutdown; cancellation is still authoritative.
          }
          throw new Error('Talk relay startup was cancelled');
        }
        ownership.activate(relaySessionId, sessionKey);
        return relay as never;
      });
    },
    appendAudio: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const relaySessionId = parseRelayId(body.relaySessionId);
      const timestamp = parseTimestamp(body.timestamp);
      const audioBase64 = parsePcm16Base64(body.audioBase64);
      requireActiveRelay(ownership, relaySessionId);
      return await gatewayManager.rpc('talk.session.appendAudio', {
        sessionId: relaySessionId,
        audioBase64,
        ...(timestamp === undefined ? {} : { timestamp }),
      }, TALK_RPC_TIMEOUT_MS);
    },
    cancelOutput: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const relaySessionId = parseRelayId(body.relaySessionId);
      requireActiveRelay(ownership, relaySessionId);
      return await gatewayManager.rpc('talk.session.cancelOutput', {
        sessionId: relaySessionId,
      }, TALK_RPC_TIMEOUT_MS);
    },
    submitToolResult: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      if (!('result' in body)) {
        throw new Error('Invalid Talk tool result');
      }
      const relaySessionId = parseRelayId(body.relaySessionId);
      const callId = requiredString(body.callId, 'Invalid Talk tool call id');
      const options = parseToolResultOptions(body.options);
      requireActiveRelay(ownership, relaySessionId);
      return await gatewayManager.rpc('talk.session.submitToolResult', {
        sessionId: relaySessionId,
        callId,
        result: body.result,
        ...(options && Object.keys(options).length > 0 ? { options } : {}),
      }, TALK_RPC_TIMEOUT_MS);
    },
    acknowledgeMark: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const relaySessionId = parseRelayId(body.relaySessionId);
      const markName = requiredString(body.markName, 'Invalid Talk mark name');
      requireActiveRelay(ownership, relaySessionId);
      return await gatewayManager.rpc('talk.session.acknowledgeMark', {
        sessionId: relaySessionId,
        markName,
      }, TALK_RPC_TIMEOUT_MS);
    },
    stopRelay: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      const relaySessionId = parseRelayId(body.relaySessionId);
      return await serializeRelayOperation(async () => {
        requireActiveRelay(ownership, relaySessionId);
        rejectPendingConsults(relaySessionId);
        try {
          return await gatewayManager.rpc('talk.session.close', {
            sessionId: relaySessionId,
          }, TALK_RPC_TIMEOUT_MS);
        } finally {
          ownership.clear(relaySessionId);
        }
      });
    },
    startAgentConsult: async (payload) => {
      const body: Record<string, unknown> = isRecord(payload) ? payload : {};
      if (!isRecord(body.args)) {
        throw new Error('Invalid Talk tool arguments');
      }
      const relaySessionId = parseRelayId(body.relaySessionId);
      const sessionKey = requiredString(body.sessionKey, 'Invalid Talk session key');
      const callId = requiredString(body.callId, 'Invalid Talk tool call id');
      const activeRelay = requireActiveRelay(ownership, relaySessionId);
      if (activeRelay.sessionKey !== sessionKey) {
        throw new Error('Talk relay session does not match the active session');
      }
      const acknowledgement = await gatewayManager.rpc('talk.client.toolCall', {
        relaySessionId,
        sessionKey,
        callId,
        name: 'openclaw_agent_consult',
        args: body.args,
      }, TALK_RPC_TIMEOUT_MS);
      const runId = completionRunId(acknowledgement);
      if (!runId) throw new Error('Invalid Agent consult acknowledgement');
      requireActiveRelay(ownership, relaySessionId);
      return await awaitAgentConsultCompletion(relaySessionId, runId);
    },
  };
}
