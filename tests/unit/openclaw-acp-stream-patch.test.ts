// @vitest-environment node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const bundlePath = process.env.CLAWX_OPENCLAW_ACP_BUNDLE_PATH
  ?? path.join(root, 'node_modules/openclaw/dist/acp-cli-BXc5GttU.js');
const gatewayBundlePath = process.env.CLAWX_OPENCLAW_GATEWAY_CHAT_BUNDLE_PATH
  ?? path.join(root, 'node_modules/openclaw/dist/server-chat-wgxNCdC3.js');
const execFileAsync = promisify(execFile);

type DeltaHandler = (this: {
  pendingPrompts: Map<string, Record<string, unknown>>;
  sessionUpdates: { emit: (value: unknown) => Promise<void> };
}, sessionId: string, messageData: Record<string, unknown>) => Promise<void>;

type ChatHandler = (this: {
  findPendingBySessionKey: () => Record<string, unknown> | undefined;
  findAmbientSession: (sessionKey: string, runId: string) => Record<string, unknown> | undefined;
  ambientSession?: Record<string, unknown>;
  handleAmbientChatEvent: (
    session: Record<string, unknown>,
    runId: string,
    state: string,
    messageData?: Record<string, unknown>,
  ) => Promise<void>;
  handleDeltaEvent: (sessionId: string, messageData: Record<string, unknown>) => Promise<void>;
  finishPrompt: (sessionId: string, pending: Record<string, unknown>, stopReason: string) => Promise<void>;
}, event: { payload: Record<string, unknown> }) => Promise<void>;

type GatewayRetryPreflight = (
  lifecyclePhase: string,
  evt: { runId: string },
  clientRunId: string,
) => void;

type GatewayTerminalEmitter = (
  sessionKey: string,
  clientRunId: string,
  sourceRunId: string,
  seq: number,
  jobState: string,
) => void;

type FinalStreamReconciler = (
  ctx: {
    state: Record<string, unknown>;
    params: { silentExpected: boolean };
    emitAssistantStreamData: (data: Record<string, unknown>) => void;
  },
  cleanedText: string,
) => void;

type PostLedgerTranscriptSelector = (
  transcript: Array<{ timestamp?: unknown; content?: unknown }>,
  ledgerReplay: { events: Array<{ at?: unknown }> },
) => Array<{ timestamp?: unknown; content?: unknown }>;

type AmbientChatHandler = (this: {
  ambientChatRuns: Map<string, Record<string, unknown>>;
  getOrCreateAmbientChatRun?: (
    session: Record<string, unknown>,
    runId: string,
  ) => Record<string, unknown> | undefined;
  sessionUpdates: { emit: (value: unknown) => Promise<void> };
  getSessionSnapshot: (sessionKey: string) => Promise<Record<string, unknown>>;
  sendSessionSnapshotUpdate: (
    session: Record<string, unknown>,
    snapshot: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<void>;
  log: (message: string) => void;
}, session: Record<string, unknown>, runId: string, state: string, messageData?: Record<string, unknown>) => Promise<void>;

type AmbientRunFactory = (this: {
  ambientChatRuns: Map<string, Record<string, unknown>>;
}, session: Record<string, unknown>, runId: string) => Record<string, unknown> | undefined;

type AmbientReplayBaselineResolver = (
  ledgerEvents: Array<{ update?: Record<string, unknown> }>,
  transcript: Array<Record<string, unknown>>,
) => { sentText?: string; sentThought?: string };

type AgentEventHandler = (this: {
  findPendingBySessionKey: () => Record<string, unknown> | undefined;
  findAmbientSession: (sessionKey: string, runId: string) => Record<string, unknown> | undefined;
  getOrCreateAmbientChatRun: (
    session: Record<string, unknown>,
    runId: string,
  ) => Record<string, unknown> | undefined;
  emitCompactionUpdate: () => Promise<void>;
  handleApprovalEvent: () => Promise<void>;
  handleDeltaEvent: (sessionId: string, messageData: Record<string, unknown>) => Promise<void>;
  handleAmbientChatEvent: (
    session: Record<string, unknown>,
    runId: string,
    state: string,
    messageData: Record<string, unknown>,
  ) => Promise<void>;
  sessionUpdates: { emit: (value: unknown) => Promise<void> };
}, event: { payload: Record<string, unknown> }) => Promise<void>;

type GatewayEventHandler = (this: {
  ambientSession?: {
    sessionKey: string;
    replayPending?: boolean;
    pendingEvents?: Array<Record<string, unknown>>;
  };
  dispatchGatewayEvent?: (event: Record<string, unknown>) => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => Promise<void>;
  handleSessionOperationEvent: (event: Record<string, unknown>) => Promise<void>;
  handleExecApprovalRequestEvent: (event: Record<string, unknown>) => void;
  handleAgentEvent: (event: Record<string, unknown>) => Promise<void>;
}, event: Record<string, unknown>) => Promise<void>;

type AmbientSessionLifecycle = {
  activate: (this: Record<string, unknown>, session: Record<string, unknown>, replayBaseline?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void>;
  complete: (this: Record<string, unknown>, session: Record<string, unknown>, replayBaseline: Record<string, unknown>) => Promise<void>;
  rollback: (this: Record<string, unknown>, session: Record<string, unknown>) => Promise<void>;
};

function extractDeltaHandler(bundle: string): DeltaHandler {
  const methodStart = bundle.indexOf('async handleDeltaEvent(sessionId, messageData)');
  const methodEnd = bundle.indexOf('\n\tasync finishPrompt', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) {
    throw new Error('OpenClaw ACP handleDeltaEvent method was not found');
  }

  const helperStart = bundle.indexOf('function resolveAcpTextDelta(previousText, nextText)');
  const helperEnd = helperStart >= 0 ? bundle.indexOf('\n//#endregion', helperStart) : -1;
  const helperSource = helperEnd > helperStart ? bundle.slice(helperStart, helperEnd) : '';
  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('async handleDeltaEvent', 'async function handleDeltaEvent');
  const context = { handleDeltaEvent: undefined as DeltaHandler | undefined };
  runInNewContext(
    `${helperSource}\nglobalThis.handleDeltaEvent = ${methodSource};`,
    context,
  );
  if (!context.handleDeltaEvent) throw new Error('OpenClaw ACP delta handler could not be loaded');
  return context.handleDeltaEvent;
}

function extractChatHandler(bundle: string): ChatHandler {
  const methodStart = bundle.indexOf('async handleChatEvent(evt)');
  const methodEnd = bundle.indexOf('\n\tasync handleDeltaEvent', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) {
    throw new Error('OpenClaw ACP handleChatEvent method was not found');
  }

  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('async handleChatEvent', 'async function handleChatEvent');
  const context = { handleChatEvent: undefined as ChatHandler | undefined };
  runInNewContext(`globalThis.handleChatEvent = ${methodSource};`, context);
  if (!context.handleChatEvent) throw new Error('OpenClaw ACP chat handler could not be loaded');
  return context.handleChatEvent;
}

function extractFinalStreamReconciler(bundle: string): FinalStreamReconciler {
  const reconcileStart = bundle.indexOf('\tconst previousStreamedText = ');
  const reconcileEnd = bundle.indexOf('\n\tconst finalAssistantText = ', reconcileStart);
  if (reconcileStart < 0 || reconcileEnd <= reconcileStart) {
    throw new Error('OpenClaw final assistant stream reconciliation was not found');
  }

  const context = {
    buildAssistantStreamData: (data: Record<string, unknown>) => data,
    suppressDeterministicApprovalOutput: false,
    suppressMessageToolOnlySourceReplyOutput: false,
    hasMedia: false,
    mediaUrls: [] as string[],
    assistantPhase: undefined,
    reconcileFinalStream: undefined as FinalStreamReconciler | undefined,
  };
  runInNewContext(
    `globalThis.reconcileFinalStream = function (ctx, cleanedText) {\n${bundle.slice(reconcileStart, reconcileEnd)}\n};`,
    context,
  );
  if (!context.reconcileFinalStream) {
    throw new Error('OpenClaw final assistant stream reconciliation could not be loaded');
  }
  return context.reconcileFinalStream;
}

function extractPostLedgerTranscriptSelector(bundle: string): PostLedgerTranscriptSelector {
  const start = bundle.indexOf('function selectPostLedgerTranscript(');
  const end = bundle.indexOf('\nconst ACP_COMPACTION_SOURCES', start);
  if (start < 0 || end <= start) {
    throw new Error('OpenClaw post-ledger transcript selector was not found');
  }
  const context = {
    selectPostLedgerTranscript: undefined as PostLedgerTranscriptSelector | undefined,
  };
  runInNewContext(
    `${bundle.slice(start, end)}\nglobalThis.selectPostLedgerTranscript = selectPostLedgerTranscript;`,
    context,
  );
  if (!context.selectPostLedgerTranscript) {
    throw new Error('OpenClaw post-ledger transcript selector could not be loaded');
  }
  return context.selectPostLedgerTranscript;
}

function extractAmbientChatHandler(bundle: string): AmbientChatHandler {
  const methodStart = bundle.indexOf('async handleAmbientChatEvent(session, runId, state, messageData)');
  const methodEnd = bundle.indexOf('\n\tasync handleChatEvent', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) {
    throw new Error('OpenClaw ambient announcement handler was not found');
  }
  const helperStart = bundle.indexOf('function resolveAcpTextDelta(previousText, nextText)');
  const helperEnd = bundle.indexOf('\n//#endregion', helperStart);
  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('async handleAmbientChatEvent', 'async function handleAmbientChatEvent');
  const context = {
    handleAmbientChatEvent: undefined as AmbientChatHandler | undefined,
  };
  runInNewContext(
    `${bundle.slice(helperStart, helperEnd)}\nglobalThis.handleAmbientChatEvent = ${methodSource};`,
    context,
  );
  if (!context.handleAmbientChatEvent) {
    throw new Error('OpenClaw ambient announcement handler could not be loaded');
  }
  return context.handleAmbientChatEvent;
}

function extractAmbientRunFactory(bundle: string): AmbientRunFactory {
  const methodStart = bundle.indexOf('getOrCreateAmbientChatRun(session, runId)');
  const methodEnd = bundle.indexOf('\n\tasync handleAmbientChatEvent', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) {
    throw new Error('OpenClaw ambient run factory was not found');
  }
  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('getOrCreateAmbientChatRun', 'function getOrCreateAmbientChatRun');
  const context = { getOrCreateAmbientChatRun: undefined as AmbientRunFactory | undefined };
  runInNewContext(`globalThis.getOrCreateAmbientChatRun = ${methodSource};`, context);
  if (!context.getOrCreateAmbientChatRun) throw new Error('OpenClaw ambient run factory could not be loaded');
  return context.getOrCreateAmbientChatRun;
}

function extractAmbientReplayBaselineResolver(bundle: string): AmbientReplayBaselineResolver {
  const start = bundle.indexOf('function resolveAmbientReplayBaseline(');
  const end = bundle.indexOf('\nfunction selectPostLedgerTranscript', start);
  if (start < 0 || end <= start) throw new Error('OpenClaw ambient replay baseline resolver was not found');
  const context = {
    extractReplayChunks,
    resolveAmbientReplayBaseline: undefined as AmbientReplayBaselineResolver | undefined,
  };
  function extractReplayChunks(message: Record<string, unknown>) {
    const role = message.role;
    if (role === 'toolResult') return [{ sessionUpdate: 'tool_call_update' }];
    const text = typeof message.content === 'string' ? message.content : '';
    if (!text || (role !== 'user' && role !== 'assistant')) return [];
    return [{
      sessionUpdate: role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
      text,
    }];
  }
  runInNewContext(
    `${bundle.slice(start, end)}\nglobalThis.resolveAmbientReplayBaseline = resolveAmbientReplayBaseline;`,
    context,
  );
  if (!context.resolveAmbientReplayBaseline) throw new Error('OpenClaw ambient replay baseline resolver could not be loaded');
  return context.resolveAmbientReplayBaseline;
}

function extractAgentEventHandler(bundle: string): AgentEventHandler {
  const methodStart = bundle.indexOf('async handleAgentEvent(evt)');
  const methodEnd = bundle.indexOf('\n\tasync handleSessionOperationEvent', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) throw new Error('OpenClaw ACP agent event handler was not found');
  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('async handleAgentEvent', 'async function handleAgentEvent');
  const context = {
    formatToolTitle: (name: unknown) => String(name ?? 'tool'),
    inferToolKind: () => 'other',
    extractToolCallLocations: () => [],
    extractToolCallContent: (value: unknown) => value,
    normalizeOptionalString: (value: unknown) => (
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    ),
    resolveAssistantEventPhase: (value: unknown) => (
      (value as { phase?: unknown } | undefined)?.phase === 'commentary' ? 'commentary' : undefined
    ),
    resolveAcpEventTextSnapshot: (previousText: string, value: unknown) => {
      const data = value as { text?: unknown; delta?: unknown };
      const nextText = typeof data?.text === 'string' ? data.text : '';
      const nextDelta = typeof data?.delta === 'string' ? data.delta : '';
      if (nextText && previousText && nextText.startsWith(previousText)) return nextText;
      if (nextDelta) return previousText + nextDelta;
      return nextText || previousText;
    },
    handleAgentEvent: undefined as AgentEventHandler | undefined,
  };
  runInNewContext(`globalThis.handleAgentEvent = ${methodSource};`, context);
  if (!context.handleAgentEvent) throw new Error('OpenClaw ACP agent event handler could not be loaded');
  return context.handleAgentEvent;
}

function extractGatewayEventHandler(bundle: string): GatewayEventHandler {
  const methodStart = bundle.indexOf('async handleGatewayEvent(evt)');
  const methodEnd = bundle.indexOf('\n\tasync initialize', methodStart);
  if (methodStart < 0 || methodEnd <= methodStart) throw new Error('OpenClaw ACP gateway event handler was not found');
  const methodSource = bundle
    .slice(methodStart, methodEnd)
    .replace('async handleGatewayEvent', 'async function handleGatewayEvent');
  const context = { handleGatewayEvent: undefined as GatewayEventHandler | undefined };
  runInNewContext(`globalThis.handleGatewayEvent = ${methodSource};`, context);
  if (!context.handleGatewayEvent) throw new Error('OpenClaw ACP gateway event handler could not be loaded');
  return context.handleGatewayEvent;
}

function extractAmbientSessionLifecycle(bundle: string): AmbientSessionLifecycle {
  const activateStart = bundle.indexOf('async activateAmbientSession(session, replayBaseline, opts = {})');
  const completeStart = bundle.indexOf('\n\tasync completeAmbientSessionReplay', activateStart);
  const rollbackStart = bundle.indexOf('\n\tasync rollbackAmbientSessionReplay', completeStart);
  const deactivateStart = bundle.indexOf('\n\tasync deactivateAmbientSession', rollbackStart);
  if (activateStart < 0 || completeStart < 0 || rollbackStart < 0 || deactivateStart < 0) {
    throw new Error('OpenClaw ambient session lifecycle methods were not found');
  }
  const context = {
    activate: undefined as AmbientSessionLifecycle['activate'] | undefined,
    complete: undefined as AmbientSessionLifecycle['complete'] | undefined,
    rollback: undefined as AmbientSessionLifecycle['rollback'] | undefined,
  };
  const asFunction = (source: string, name: string) => source.replace(`async ${name}`, `async function ${name}`);
  runInNewContext(`
    globalThis.activate = ${asFunction(bundle.slice(activateStart, completeStart), 'activateAmbientSession')};
    globalThis.complete = ${asFunction(bundle.slice(completeStart + 2, rollbackStart), 'completeAmbientSessionReplay')};
    globalThis.rollback = ${asFunction(bundle.slice(rollbackStart + 2, deactivateStart), 'rollbackAmbientSessionReplay')};
  `, context);
  if (!context.activate || !context.complete || !context.rollback) {
    throw new Error('OpenClaw ambient session lifecycle methods could not be loaded');
  }
  return {
    activate: context.activate,
    complete: context.complete,
    rollback: context.rollback,
  };
}

describe('OpenClaw ACP assistant stream patch', () => {
  it('selects only finite transcript records strictly newer than a complete ledger', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const selectPostLedgerTranscript = extractPostLedgerTranscriptSelector(bundle);
    const before = { timestamp: 99, content: 'before' };
    const boundary = { timestamp: 200, content: 'boundary' };
    const missingTimestamp = { content: 'unknown' };
    const after = { timestamp: 201, content: 'announcement' };

    expect(selectPostLedgerTranscript(
      [
        before,
        boundary,
        missingTimestamp,
        { timestamp: '2026-08-31T00:00:00.000Z', content: 'string timestamp' },
        { timestamp: Number.POSITIVE_INFINITY, content: 'infinite timestamp' },
        after,
      ],
      { events: [{ at: 100 }, { at: 200 }, { at: Number.NaN }] },
    )).toEqual([after]);
    expect(selectPostLedgerTranscript([
      before,
      missingTimestamp,
      { timestamp: '2026-08-31T00:00:00.000Z', content: 'string timestamp' },
      { timestamp: Number.POSITIVE_INFINITY, content: 'infinite timestamp' },
      after,
    ], { events: [] })).toEqual([before, after]);

    const loadStart = bundle.indexOf('async loadSession(params)');
    const loadEnd = bundle.indexOf('\n\tasync listSessions', loadStart);
    const loadSource = bundle.slice(loadStart, loadEnd);
    expect(loadSource).not.toContain('ledgerReplay.complete ? Promise.resolve([])');
    expect(loadSource).toContain('selectPostLedgerTranscript(transcript, ledgerReplay)');
    expect(loadSource.indexOf('replayLedgerSession')).toBeLessThan(
      loadSource.indexOf('selectPostLedgerTranscript'),
    );
  });

  it('streams no-pending announce runs for the loaded session and checkpoints their terminal', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleAmbientChatEvent = extractAmbientChatHandler(bundle);
    const getOrCreateAmbientChatRun = extractAmbientRunFactory(bundle);
    const calls: Array<Record<string, unknown>> = [];
    const session = {
      sessionId: 'parent-session',
      sessionKey: 'agent:main:session-1',
      ledgerSessionId: 'ledger-session',
    };
    const receiver = {
      ambientChatRuns: new Map<string, Record<string, unknown>>(),
      getOrCreateAmbientChatRun: (routedSession: Record<string, unknown>, ambientRunId: string) => (
        getOrCreateAmbientChatRun.call(receiver, routedSession, ambientRunId)
      ),
      sessionUpdates: {
        emit: async (value: unknown) => calls.push(value as Record<string, unknown>),
      },
      getSessionSnapshot: async () => ({ metadata: { title: 'Parent' } }),
      sendSessionSnapshotUpdate: async (
        routedSession: Record<string, unknown>,
        _snapshot: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => calls.push({ checkpoint: true, routedSession, options }),
      log: () => undefined,
    };
    const runId = 'announce:v1:agent:main:subagent:child:run';

    await handleAmbientChatEvent.call(receiver, session, runId, 'delta', {
      content: [{ type: 'text', text: 'Two tasks complete' }],
    });
    await handleAmbientChatEvent.call(receiver, session, runId, 'delta', {
      content: [{ type: 'text', text: 'Two tasks complete; one remains' }],
    });
    await handleAmbientChatEvent.call(receiver, session, runId, 'final', {
      content: [{ type: 'text', text: 'Two tasks complete; one remains' }],
    });
    await handleAmbientChatEvent.call(receiver, session, runId, 'final', {
      content: [{ type: 'text', text: 'duplicate terminal' }],
    });

    expect(calls.slice(0, 2).map((call) => (
      call.update as { content?: { text?: string } }
    ).content?.text)).toEqual(['Two tasks complete', '; one remains']);
    expect(calls.slice(0, 2)).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        sessionKey: session.sessionKey,
        ledgerSessionId: session.ledgerSessionId,
        runId,
        record: true,
      }),
      expect.objectContaining({
        sessionId: session.sessionId,
        sessionKey: session.sessionKey,
        ledgerSessionId: session.ledgerSessionId,
        runId,
        record: true,
      }),
    ]);
    expect(calls[2]).toEqual(expect.objectContaining({
      checkpoint: true,
      options: { includeControls: false, record: true, runId },
    }));

    const loadStart = bundle.indexOf('async loadSession(params)');
    const loadEnd = bundle.indexOf('\n\tasync listSessions', loadStart);
    expect(bundle.slice(loadStart, loadEnd)).toContain('activateAmbientSession(session');
    for (const [startMarker, endMarker] of [
      ['async newSession(params)', '\n\tasync loadSession'],
      ['async resumeSession(params)', '\n\tasync closeSession'],
    ]) {
      const start = bundle.indexOf(startMarker);
      const end = bundle.indexOf(endMarker, start);
      expect(bundle.slice(start, end)).toContain('activateAmbientSession(session)');
    }
    const closeStart = bundle.indexOf('async closeSession(params)');
    const closeEnd = bundle.indexOf('\n\tasync authenticate', closeStart);
    expect(bundle.slice(closeStart, closeEnd)).toContain('deactivateAmbientSession(session.sessionId)');
    const shutdownStart = bundle.indexOf('async shutdown()');
    const shutdownEnd = bundle.indexOf('\n\tsupportsClientReadTextFile', shutdownStart);
    expect(bundle.slice(shutdownStart, shutdownEnd)).toContain('deactivateAmbientSession()');
    const promptStart = bundle.indexOf('async prompt(params)');
    const promptEnd = bundle.indexOf('\n\tasync cancel', promptStart);
    expect(bundle.slice(promptStart, promptEnd)).toContain('acquireSessionMessageSubscription(session.sessionKey)');
    const chatStart = bundle.indexOf('async handleChatEvent(evt)');
    const chatEnd = bundle.indexOf('\n\tasync handleDeltaEvent', chatStart);
    const chatSource = bundle.slice(chatStart, chatEnd);
    const ambientRouteStart = bundle.indexOf('\n\tfindAmbientSession(sessionKey, runId) {');
    const ambientRouteEnd = bundle.indexOf('\n\tgetOrCreateAmbientChatRun', ambientRouteStart);
    const ambientRouteSource = bundle.slice(ambientRouteStart, ambientRouteEnd);
    expect(chatSource).toContain('handleAmbientChatEvent');
    expect(ambientRouteSource).toContain('normalizedRunId.startsWith("announce:v1:")');
    expect(ambientRouteSource).toContain('ambientSession.sessionKey !== sessionKey');
    expect(ambientRouteSource).toContain('normalizeOptionalString(runId)');

    for (let index = 0; index < 105; index += 1) {
      await handleAmbientChatEvent.call(
        receiver,
        session,
        `announce:v1:bounded:${index}`,
        'final',
      );
    }
    expect(receiver.ambientChatRuns.size).toBeLessThanOrEqual(100);
  });

  it('routes no-pending ordinary runs only for the exact loaded native subagent', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleChatEvent = extractChatHandler(bundle);
    const childSession = {
      sessionId: 'child-session',
      sessionKey: 'agent:main:subagent:child-1',
    };
    const calls: string[] = [];
    const receiver = {
      ambientSession: childSession,
      findPendingBySessionKey: () => undefined,
      findAmbientSession: (sessionKey: string, runId: string) => {
        const current = receiver.ambientSession;
        const normalizedRunId = runId.trim();
        if (current?.sessionKey !== sessionKey || !normalizedRunId) return undefined;
        const parts = sessionKey.split(':');
        if (normalizedRunId.startsWith('announce:v1:') || (
          parts.length === 4 && parts[0] === 'agent' && parts[1] && parts[2] === 'subagent' && parts[3]
        )) return current;
        return undefined;
      },
      handleAmbientChatEvent: async (
        session: Record<string, unknown>,
        runId: string,
        state: string,
      ) => {
        calls.push(`${String(session.sessionKey)}:${runId}:${state}`);
      },
      handleDeltaEvent: async () => undefined,
      finishPrompt: async () => undefined,
    };

    const emit = async (sessionKey: string, runId: string) => {
      await handleChatEvent.call(receiver, {
        payload: {
          sessionKey,
          runId,
          state: 'delta',
          message: { role: 'assistant', content: [{ type: 'text', text: 'live child output' }] },
        },
      });
    };

    await emit(childSession.sessionKey, 'child-run-1');
    await emit(childSession.sessionKey, '');
    await emit(childSession.sessionKey, '   ');
    await emit('agent:main:subagent:other-child', 'other-child-run');
    receiver.ambientSession = { sessionId: 'parent-session', sessionKey: 'agent:main:main' };
    await emit('agent:main:main', 'ordinary-parent-run');
    await emit('agent:main:main', 'announce:v1:child-run:parent');
    receiver.ambientSession = { sessionId: 'malformed-child', sessionKey: 'agent:main:subagent:' };
    await emit('agent:main:subagent:', 'malformed-child-run');

    expect(calls).toEqual([
      'agent:main:subagent:child-1:child-run-1:delta',
      'agent:main:main:announce:v1:child-run:parent:delta',
    ]);
  });

  it('routes commentary agent events as live thought for an exact loaded native subagent', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleAgentEvent = extractAgentEventHandler(bundle);
    const childSession = {
      sessionId: 'child-session',
      sessionKey: 'agent:main:subagent:child-1',
    };
    const ambientRun: Record<string, unknown> = { settled: false, sentThought: 'Need' };
    const messages: Record<string, unknown>[] = [];

    await handleAgentEvent.call({
      findPendingBySessionKey: () => undefined,
      findAmbientSession: () => childSession,
      getOrCreateAmbientChatRun: () => ambientRun,
      emitCompactionUpdate: async () => undefined,
      handleApprovalEvent: async () => undefined,
      handleDeltaEvent: async () => undefined,
      handleAmbientChatEvent: async (_session, _runId, _state, messageData) => {
        messages.push(messageData);
      },
      sessionUpdates: { emit: async () => undefined },
    }, {
      payload: {
        stream: 'assistant',
        runId: 'child-run',
        sessionKey: childSession.sessionKey,
        data: { phase: 'commentary', text: 'Need evidence', delta: ' evidence' },
      },
    });

    expect(messages).toEqual([{
      content: [{ type: 'thinking', thinking: 'Need evidence' }],
    }]);
  });

  it('buffers exact-session Gateway events while session replay establishes its baseline', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleGatewayEvent = extractGatewayEventHandler(bundle);
    const pendingEvents: Array<Record<string, unknown>> = [];
    const routed: string[] = [];
    const event = {
      event: 'chat',
      payload: {
        sessionKey: 'agent:main:subagent:child-1',
        runId: 'child-run',
        state: 'delta',
      },
    };

    await handleGatewayEvent.call({
      ambientSession: {
        sessionKey: 'agent:main:subagent:child-1',
        replayPending: true,
        pendingEvents,
      },
      dispatchGatewayEvent: async () => routed.push('dispatch'),
      handleChatEvent: async () => routed.push('chat'),
      handleSessionOperationEvent: async () => routed.push('operation'),
      handleExecApprovalRequestEvent: () => routed.push('approval'),
      handleAgentEvent: async () => routed.push('agent'),
    }, event);

    expect(pendingEvents).toEqual([event]);
    expect(routed).toEqual([]);

    const loadStart = bundle.indexOf('async loadSession(params)');
    const loadEnd = bundle.indexOf('\n\tasync listSessions', loadStart);
    const loadSource = bundle.slice(loadStart, loadEnd);
    expect(loadSource.indexOf('activateAmbientSession(session, void 0, { replayPending: true })'))
      .toBeLessThan(loadSource.indexOf('this.getSessionTranscript(session.sessionKey)'));
    expect(loadSource).toContain('completeAmbientSessionReplay(session, replayBaseline)');
    expect(loadSource).toContain('rollbackAmbientSessionReplay(session)');
    expect(loadSource).not.toContain('deactivateAmbientSession(session.sessionId)');
    expect(loadSource.indexOf('sendAvailableCommands(session, { record: false })'))
      .toBeLessThan(loadSource.indexOf('completeAmbientSessionReplay(session, replayBaseline)'));
  });

  it('keeps the previous ambient owner until replay commits and restores it on rollback', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const lifecycle = extractAmbientSessionLifecycle(bundle);
    const previous = { sessionId: 'parent-session', sessionKey: 'agent:main:main' };
    const child = { sessionId: 'child-session', sessionKey: 'agent:main:subagent:child-1' };
    const acquired: string[] = [];
    const released: string[] = [];
    const dispatched: string[] = [];
    const receiver = {
      ambientSession: previous as Record<string, unknown> | undefined,
      ambientChatRuns: new Map<string, Record<string, unknown>>([['old-run', {}]]),
      acquireSessionMessageSubscription: async (sessionKey: string) => { acquired.push(sessionKey); },
      releaseSessionMessageSubscription: async (sessionKey: string) => { released.push(sessionKey); },
      dispatchGatewayEvent: async (event: Record<string, unknown>) => {
        dispatched.push(String(event.event));
      },
    };

    await lifecycle.activate.call(receiver, child, undefined, { replayPending: true });
    expect(receiver.ambientSession).toMatchObject({
      ...child,
      replayPending: true,
      previousAmbientSession: previous,
      replaySubscriptionAcquired: true,
    });
    expect(acquired).toEqual([child.sessionKey]);
    expect(released).toEqual([]);

    await lifecycle.rollback.call(receiver, child);
    expect(receiver.ambientSession).toBe(previous);
    expect(released).toEqual([child.sessionKey]);

    released.length = 0;
    await lifecycle.activate.call(receiver, child, undefined, { replayPending: true });
    const pendingSession = receiver.ambientSession as {
      pendingEvents: Array<Record<string, unknown>>;
      replayPending: boolean;
      sentText?: string;
    };
    pendingSession.pendingEvents.push({ event: 'agent' }, { event: 'chat' });
    await lifecycle.complete.call(receiver, child, { sentText: 'replayed' });

    expect(dispatched).toEqual(['agent', 'chat']);
    expect(receiver.ambientSession).toMatchObject({ ...child, sentText: 'replayed', replayPending: false });
    expect(receiver.ambientSession).not.toHaveProperty('previousAmbientSession');
    expect(receiver.ambientSession).not.toHaveProperty('pendingEvents');
    expect(released).toEqual([previous.sessionKey]);
  });

  it('continues a partially replayed child message across tool boundaries without repeating its cumulative prefix', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const resolveAmbientReplayBaseline = extractAmbientReplayBaselineResolver(bundle);
    const getOrCreateAmbientChatRun = extractAmbientRunFactory(bundle);
    const handleAmbientChatEvent = extractAmbientChatHandler(bundle);
    const handleAgentEvent = extractAgentEventHandler(bundle);
    const baseline = resolveAmbientReplayBaseline([], [
      { role: 'assistant', content: 'A' },
      { role: 'toolResult', content: 'tool result' },
      { role: 'assistant', content: 'B' },
    ]);
    const session = {
      sessionId: 'child-session',
      sessionKey: 'agent:main:subagent:child-1',
      ...baseline,
    };
    const emitted: string[] = [];
    const receiver = {
      ambientChatRuns: new Map<string, Record<string, unknown>>(),
      getOrCreateAmbientChatRun: (
        routedSession: Record<string, unknown>,
        runId: string,
      ) => getOrCreateAmbientChatRun.call(receiver, routedSession, runId),
      sessionUpdates: {
        emit: async (value: unknown) => {
          const update = (value as { update?: { content?: { text?: string } } }).update;
          if (update?.content?.text) emitted.push(update.content.text);
        },
      },
      getSessionSnapshot: async () => ({}),
      sendSessionSnapshotUpdate: async () => undefined,
      log: () => undefined,
    };

    await handleAgentEvent.call({
      ...receiver,
      findPendingBySessionKey: () => undefined,
      findAmbientSession: () => session,
      emitCompactionUpdate: async () => undefined,
      handleApprovalEvent: async () => undefined,
    }, {
      payload: {
        stream: 'tool',
        runId: 'child-run',
        sessionKey: session.sessionKey,
        data: { phase: 'start', name: 'web_fetch', toolCallId: 'tool-1', args: {} },
      },
    });
    await handleAmbientChatEvent.call(receiver, session, 'child-run', 'delta', {
      content: [{ type: 'text', text: 'ABC' }],
    });

    expect(emitted).toEqual(['C']);
    expect(session).not.toHaveProperty('sentText');
    const loadStart = bundle.indexOf('async loadSession(params)');
    const loadEnd = bundle.indexOf('\n\tasync listSessions', loadStart);
    const loadSource = bundle.slice(loadStart, loadEnd);
    expect(loadSource).toContain('resolveAmbientReplayBaseline(ledgerReplay.complete ? ledgerReplay.events : [], transcriptReplay)');
    expect(loadSource).toContain('completeAmbientSessionReplay(session, replayBaseline)');
  });

  it('streams tool lifecycle updates for an exact loaded native subagent without a pending prompt', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleAgentEvent = extractAgentEventHandler(bundle);
    const childSession = {
      sessionId: 'child-session',
      sessionKey: 'agent:main:subagent:child-1',
    };
    const ambientRun: Record<string, unknown> = { settled: false };
    const calls: Array<Record<string, unknown>> = [];
    const receiver = {
      findPendingBySessionKey: () => undefined,
      findAmbientSession: (sessionKey: string, runId: string) => (
        sessionKey === childSession.sessionKey && runId === 'child-run' ? childSession : undefined
      ),
      getOrCreateAmbientChatRun: () => ambientRun,
      emitCompactionUpdate: async () => undefined,
      handleApprovalEvent: async () => undefined,
      sessionUpdates: { emit: async (value: unknown) => calls.push(value as Record<string, unknown>) },
    };
    const emit = async (phase: string, data: Record<string, unknown> = {}) => {
      await handleAgentEvent.call(receiver, {
        payload: {
          stream: 'tool',
          runId: 'child-run',
          sessionKey: childSession.sessionKey,
          data: { phase, name: 'web_fetch', toolCallId: 'child-tool', ...data },
        },
      });
    };

    await emit('start', { args: { url: 'https://example.com' } });
    await emit('update', { partialResult: { content: [{ type: 'text', text: 'fetching' }] } });
    await emit('result', { result: { content: [{ type: 'text', text: 'done' }] } });

    expect(calls.map((call) => call.update)).toEqual([
      expect.objectContaining({ sessionUpdate: 'tool_call', toolCallId: 'child-tool', status: 'in_progress' }),
      expect.objectContaining({ sessionUpdate: 'tool_call_update', toolCallId: 'child-tool', status: 'in_progress' }),
      expect.objectContaining({ sessionUpdate: 'tool_call_update', toolCallId: 'child-tool', status: 'completed' }),
    ]);
    expect(calls).toEqual(calls.map((_call) => expect.objectContaining({
      sessionId: childSession.sessionId,
      sessionKey: childSession.sessionKey,
      runId: 'child-run',
      record: true,
    })));
  });

  it('reconciles the final assistant snapshot against text actually emitted to Gateway', async () => {
    const bundle = await readFile(path.join(root, 'node_modules/openclaw/dist/selection-JInn13lc.js'), 'utf8');
    const reconcileFinalStream = extractFinalStreamReconciler(bundle);
    const emitted: Record<string, unknown>[] = [];
    const state = {
      emittedAssistantUpdate: true,
      lastStreamedAssistantCleaned: 'complete response',
      lastEmittedAssistantCleaned: 'complete',
    };

    reconcileFinalStream({
      state,
      params: { silentExpected: false },
      emitAssistantStreamData: (data) => emitted.push(data),
    }, 'complete response');

    expect(emitted).toEqual([expect.objectContaining({
      text: 'complete response',
      delta: ' response',
    })]);
    expect(state.lastEmittedAssistantCleaned).toBe('complete response');
  });

  it('retains buffered assistant text through retry grace and clears it when retry starts', async () => {
    const bundle = await readFile(gatewayBundlePath, 'utf8');
    const preflightStart = bundle.indexOf('const restartsAfterLifecycleError =');
    const preflightEnd = bundle.indexOf('\n\t\tconst spawnedBy', preflightStart);
    const branchStart = bundle.indexOf('if (lifecyclePhase === "error")');
    const branchEnd = bundle.indexOf('\n\t\tif (lifecyclePhase === "end")', branchStart);

    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(preflightEnd).toBeGreaterThan(preflightStart);
    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const pendingTerminalLifecycleErrors = new Map([['source-run', {}]]);
    const calls: string[] = [];
    const context = {
      pendingTerminalLifecycleErrors,
      clearPendingTerminalLifecycleError: (runId: string) => {
        calls.push(`clear-pending:${runId}`);
        pendingTerminalLifecycleErrors.delete(runId);
      },
      clearBufferedChatState: (runId: string) => calls.push(`clear-buffer:${runId}`),
      runRetryPreflight: undefined as GatewayRetryPreflight | undefined,
    };
    runInNewContext(
      `globalThis.runRetryPreflight = function (lifecyclePhase, evt, clientRunId) {\n${bundle.slice(preflightStart, preflightEnd)}\n};`,
      context,
    );

    context.runRetryPreflight?.('error', { runId: 'source-run' }, 'client-run');
    expect(calls).toEqual([]);

    context.runRetryPreflight?.('start', { runId: 'source-run' }, 'client-run');
    expect(calls).toEqual([
      'clear-pending:source-run',
      'clear-buffer:client-run',
    ]);
    expect(bundle.slice(branchStart, branchEnd)).not.toContain('clearBufferedChatState(clientRunId);');
  });

  it('flushes retained Gateway text before clearing and sending an aborted terminal', async () => {
    const bundle = await readFile(gatewayBundlePath, 'utf8');
    const declaration = 'const emitChatTerminal = ';
    const emitterStart = bundle.indexOf(declaration);
    const emitterEnd = bundle.indexOf('\n\tconst sendAgentPayload', emitterStart);
    expect(emitterStart).toBeGreaterThanOrEqual(0);
    expect(emitterEnd).toBeGreaterThan(emitterStart);

    const calls: string[] = [];
    const context = {
      resolveBufferedChatTextState: () => ({
        text: 'complete buffered response',
        shouldSuppressSilent: false,
      }),
      flushBufferedChatDeltaIfNeeded: () => calls.push('flush'),
      chatRunState: { clearRun: () => calls.push('clear') },
      resolveSpawnedBy: () => null,
      sendChatPayload: (_sessionKey: string, payload: unknown) => calls.push(`send:${JSON.stringify(payload)}`),
      emitChatTerminal: undefined as GatewayTerminalEmitter | undefined,
    };
    const emitterSource = bundle
      .slice(emitterStart + declaration.length, emitterEnd)
      .replace(/;\s*$/, '');
    runInNewContext(`globalThis.emitChatTerminal = ${emitterSource};`, context);

    context.emitChatTerminal?.('session-key', 'client-run', 'source-run', 7, 'aborted');

    expect(calls.slice(0, 2)).toEqual(['flush', 'clear']);
    expect(calls[2]).toContain('"state":"aborted"');
    expect(calls[2]).toContain('"text":"complete buffered response"');
  });

  it('records buffered text carried by an aborted terminal before settling', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleChatEvent = extractChatHandler(bundle);
    const handleDeltaEvent = extractDeltaHandler(bundle);
    const streamedText = 'already streamed';
    const missingSuffix = ' plus terminal suffix';
    const pending = {
      sessionId: 'snapshot-session',
      sessionKey: 'agent:main:snapshot-session',
      idempotencyKey: 'snapshot-run',
      sentText: streamedText,
      sentTextLength: streamedText.length,
    };
    const calls: string[] = [];
    const receiver = {
      pendingPrompts: new Map<string, Record<string, unknown>>([
        [pending.sessionId, pending],
      ]),
      sessionUpdates: {
        emit: async (value: unknown) => {
          const update = (value as { update?: { content?: { text?: string } } }).update;
          calls.push(`text:${update?.content?.text ?? ''}`);
        },
      },
      findPendingBySessionKey: () => pending,
      handleDeltaEvent: async (_sessionId: string, messageData: Record<string, unknown>) => {
        await handleDeltaEvent.call(receiver, pending.sessionId, messageData);
      },
      finishPrompt: async (_sessionId: string, _pending: Record<string, unknown>, stopReason: string) => {
        calls.push(`finish:${stopReason}`);
      },
    };

    await handleChatEvent.call(receiver, {
      payload: {
        sessionKey: pending.sessionKey,
        runId: pending.idempotencyKey,
        state: 'aborted',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `${streamedText}${missingSuffix}` }],
        },
      },
    });

    expect(calls).toEqual([
      `text:${missingSuffix}`,
      'finish:cancelled',
    ]);
  });

  it('emits a shorter non-prefix tail through the bundled delta handler', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const handleDeltaEvent = extractDeltaHandler(bundle);
    const firstChunk = 'Inspection complete. The generated report passed validation.\n\n- Source: `report.txt`\n- Summary: all primary checks are complete\n- Result: val';
    const trailingChunk = 'id\n- Package: `report.zip`';
    const chunks: string[] = [];
    const receiver = {
      pendingPrompts: new Map<string, Record<string, unknown>>([
        ['snapshot-session', {
          sessionKey: 'agent:main:snapshot-session',
          idempotencyKey: 'snapshot-run',
          sentTextLength: 0,
        }],
      ]),
      sessionUpdates: {
        emit: async (value: unknown) => {
          const update = (value as { update?: { sessionUpdate?: string; content?: { text?: string } } }).update;
          if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
            chunks.push(update.content.text);
          }
        },
      },
    };

    await handleDeltaEvent.call(receiver, 'snapshot-session', {
      content: [{ type: 'text', text: firstChunk }],
    });
    await handleDeltaEvent.call(receiver, 'snapshot-session', {
      content: [{ type: 'text', text: trailingChunk }],
    });

    expect(chunks).toEqual([firstChunk, trailingChunk]);
  });

  it('emits a shorter non-prefix tail after an earlier chunk', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const start = bundle.indexOf('function resolveAcpTextDelta(previousText, nextText)');
    const end = bundle.indexOf('\n//#endregion', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const context = {
      resolveAcpTextDelta: undefined as ((previousText: string, nextText: string) => string) | undefined,
    };
    runInNewContext(
      `${bundle.slice(start, end)}\nglobalThis.resolveAcpTextDelta = resolveAcpTextDelta;`,
      context,
    );
    const resolveAcpTextDelta = context.resolveAcpTextDelta;
    expect(resolveAcpTextDelta).toBeTypeOf('function');

    const firstChunk = 'Inspection complete. The generated report passed validation.\n\n- Source: `report.txt`\n- Summary: all primary checks are complete\n- Result: val';
    const trailingChunk = 'id\n- Package: `report.zip`';

    expect(resolveAcpTextDelta?.('', firstChunk)).toBe(firstChunk);
    expect(resolveAcpTextDelta?.(firstChunk, trailingChunk)).toBe(trailingChunk);
  });

  it('keeps monotonic snapshots incremental and ignores identical or stale prefixes', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const start = bundle.indexOf('function resolveAcpTextDelta(previousText, nextText)');
    const end = bundle.indexOf('\n//#endregion', start);
    const context = {
      resolveAcpTextDelta: undefined as ((previousText: string, nextText: string) => string) | undefined,
    };
    runInNewContext(
      `${bundle.slice(start, end)}\nglobalThis.resolveAcpTextDelta = resolveAcpTextDelta;`,
      context,
    );

    expect(context.resolveAcpTextDelta?.('Hello', 'Hello world')).toBe(' world');
    expect(context.resolveAcpTextDelta?.('Hello world', 'Hello world')).toBe('');
    expect(context.resolveAcpTextDelta?.('Hello world', 'Hello')).toBe('');
  });

  it('uses the snapshot-aware delta in both assistant text and thought streams', async () => {
    const bundle = await readFile(bundlePath, 'utf8');
    const patch = await readFile(path.join(root, 'patches/openclaw@2026.7.1-2.patch'), 'utf8');
    const handleDeltaStart = bundle.indexOf('async handleDeltaEvent(sessionId, messageData)');
    const handleDeltaEnd = bundle.indexOf('\n\tasync finishPrompt', handleDeltaStart);
    const handleDeltaEvent = bundle.slice(handleDeltaStart, handleDeltaEnd);

    expect(handleDeltaEvent.match(/resolveAcpTextDelta/g)).toHaveLength(2);
    expect(patch).toContain('function resolveAcpTextDelta(previousText, nextText)');
    await expect(execFileAsync(process.execPath, ['--check', bundlePath])).resolves.toMatchObject({ stderr: '' });
  });
});
