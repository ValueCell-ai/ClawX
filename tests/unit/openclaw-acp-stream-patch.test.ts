// @vitest-environment node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');
const execFileAsync = promisify(execFile);

// Guards the ACP prompt-stream pieces ported onto the 2026.10.5 translator
// classes: snapshot-aware deltas, commentary routing, compaction/session
// operation routing, tool replay, and true-error terminal settlement. Ambient
// subagent streaming is covered by openclaw-acp-ambient-stream.test.ts.
describe('OpenClaw ACP assistant stream patch', () => {
  let bundle: string;

  beforeAll(async () => {
    bundle = await readFile(path.join(dist, 'server-D2T0Amp5.mjs'), 'utf8');
  });

  function loadSnapshotHelpers() {
    const start = bundle.indexOf('function resolveAcpEventTextSnapshot(previousText, data)');
    const end = bundle.indexOf('// ClawX: replay tool results', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const context = {} as Record<string, unknown>;
    runInNewContext(
      `${bundle.slice(start, end)}
      globalThis.resolveAcpEventTextSnapshot = resolveAcpEventTextSnapshot;
      globalThis.resolveAcpTextDelta = resolveAcpTextDelta;
      globalThis.trackAcpTextEmission = trackAcpTextEmission;
      globalThis.closeAcpTextSegment = closeAcpTextSegment;
      globalThis.resolveAcpFinalTextDelta = resolveAcpFinalTextDelta;`,
      context,
    );
    return context as {
      resolveAcpEventTextSnapshot: (previous: string, data: { text?: string; delta?: string }) => string;
      resolveAcpTextDelta: (previous: string, next: string) => string;
      trackAcpTextEmission: (state: { emittedText?: unknown }, text: string, emission: Promise<void>) => Promise<void>;
      closeAcpTextSegment: (state: { emittedText?: unknown }) => void;
      resolveAcpFinalTextDelta: (state: { emittedText?: unknown }, finalText: string) => string | undefined;
    };
  }

  it('keeps monotonic snapshots incremental and ignores identical or stale prefixes', () => {
    const { resolveAcpTextDelta } = loadSnapshotHelpers();
    expect(resolveAcpTextDelta('', 'Hello')).toBe('Hello');
    expect(resolveAcpTextDelta('Hello', 'Hello world')).toBe(' world');
    expect(resolveAcpTextDelta('Hello', 'Hello')).toBe('');
    expect(resolveAcpTextDelta('Hello world', 'Hello')).toBe('');
  });

  it('emits a shorter non-prefix tail after an earlier chunk', () => {
    const { resolveAcpTextDelta } = loadSnapshotHelpers();
    expect(resolveAcpTextDelta('Draft one', 'Rewritten')).toBe('Rewritten');
  });

  it('resolves cumulative text, deltas, and stale snapshots into one snapshot', () => {
    const { resolveAcpEventTextSnapshot } = loadSnapshotHelpers();
    expect(resolveAcpEventTextSnapshot('', { text: 'Hello' })).toBe('Hello');
    expect(resolveAcpEventTextSnapshot('Hello', { text: 'Hello world' })).toBe('Hello world');
    expect(resolveAcpEventTextSnapshot('Hello', { delta: ' world' })).toBe('Hello world');
    expect(resolveAcpEventTextSnapshot('Hello world', { text: 'Hello' })).toBe('Hello world');
    expect(resolveAcpEventTextSnapshot('Hello', { text: 'Hello' })).toBe('Hello');
  });

  it('retains producer order across tool boundaries while earlier delivery is pending', async () => {
    const { trackAcpTextEmission, closeAcpTextSegment, resolveAcpFinalTextDelta } = loadSnapshotHelpers();
    const state = {};
    let deliver!: () => void;
    const first = trackAcpTextEmission(state, 'First story', new Promise<void>((resolve) => { deliver = resolve; }));
    closeAcpTextSegment(state);
    const second = trackAcpTextEmission(state, 'Second story', Promise.resolve());
    expect(resolveAcpFinalTextDelta(state, 'First story\n\nSecond story')).toBe('');
    expect(resolveAcpFinalTextDelta(state, 'First story\n\nSecond story\nUnseen tail')).toBe('\nUnseen tail');
    expect(resolveAcpFinalTextDelta(state, 'A different final reply')).toBeUndefined();
    deliver();
    await Promise.all([first, second]);
  });

  it('invalidates a failed emission without poisoning a successor run', async () => {
    const { trackAcpTextEmission, resolveAcpFinalTextDelta } = loadSnapshotHelpers();
    const state: { emittedText?: unknown } = {};
    await expect(trackAcpTextEmission(state, 'Failed story', Promise.reject(new Error('delivery failed')))).rejects.toThrow('delivery failed');
    expect(resolveAcpFinalTextDelta(state, 'Failed story')).toBeUndefined();
    state.emittedText = undefined;
    let reject!: (error: Error) => void;
    const old = trackAcpTextEmission(state, 'Interrupted run', new Promise<void>((_resolve, failure) => { reject = failure; }));
    const failed = expect(old).rejects.toThrow('late failure');
    state.emittedText = undefined; // Trusted successor adoption resets run state.
    await trackAcpTextEmission(state, 'Successor story', Promise.resolve());
    reject(new Error('late failure'));
    await failed;
    expect(resolveAcpFinalTextDelta(state, 'Successor story')).toBe('');
  });

  it('uses the snapshot-aware delta in the prompt text and thought streams', () => {
    const start = bundle.indexOf('async handleDeltaEvent(pending, messageData,');
    const end = bundle.indexOf('async finishPrompt(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const source = bundle.slice(start, end);
    expect(source).toContain('resolveAcpEventTextSnapshot(previousText, { text: fullText })');
    expect(source).toContain('resolveAcpTextDelta(previousText, nextText)');
  });

  it('routes commentary assistant events as live thought', () => {
    const start = bundle.indexOf('if (stream === "assistant")');
    const end = bundle.indexOf('if (stream !== "tool") return;', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const source = bundle.slice(start, end);
    expect(source).toContain('resolveAssistantEventPhase(data) !== "commentary"');
    expect(source).toContain('resolveAcpEventTextSnapshot(commentaryPending.sentThought ?? "", data)');
    expect(source).toContain('sessionUpdate: "agent_thought_chunk"');
  });

  it('settles true error terminals with the Gateway error instead of end_turn', () => {
    const start = bundle.indexOf('if (state === "error") {');
    const end = bundle.indexOf('async handleDeltaEvent(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    const source = bundle.slice(start, end);
    expect(source).toContain('rejectPendingPrompt(pending, new Error(errorMessage))');
    expect(source).not.toContain('stopReason = payload.errorKind === "refusal"');
  });

  function loadDispatchHarness() {
    const dispatchStart = bundle.indexOf('async dispatchGatewayEvent(evt) {');
    const operationStart = bundle.indexOf('async handleSessionOperationEvent(evt) {', dispatchStart);
    const end = bundle.indexOf('async prompt(params) {', operationStart);
    expect(dispatchStart).toBeGreaterThanOrEqual(0);
    expect(operationStart).toBeGreaterThan(dispatchStart);
    expect(end).toBeGreaterThan(operationStart);
    const methods = runInNewContext(`({
      ${bundle.slice(dispatchStart, operationStart)},
      ${bundle.slice(operationStart, end)}
    })`, {
      normalizeOptionalString: (value: unknown) => (
        typeof value === 'string' && value.trim() ? value.trim() : undefined
      ),
    }) as { dispatchGatewayEvent: (event: Record<string, unknown>) => Promise<void> };
    const pending = { sessionId: 'acp-session', sessionKey: 'agent:main:fixture', idempotencyKey: 'prompt-run' };
    const ambient = {
      handleAgentEvent: vi.fn().mockResolvedValue(false),
      emitCompactionUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const agentEvents = {
      handleAgentEvent: vi.fn().mockResolvedValue(undefined),
    };
    const stream = Object.assign(methods, {
      findPendingBySessionKey: vi.fn().mockReturnValue(pending),
      findUniquePendingBySessionKey: vi.fn().mockReturnValue(pending),
      ambient,
      agentEvents,
    });
    return { stream, pending, ambient, agentEvents };
  }

  it('dispatches run-owned and ambient session.tool events without duplicate delivery', async () => {
    const { stream, pending, ambient, agentEvents } = loadDispatchHarness();
    const event = {
      event: 'session.tool',
      payload: { sessionKey: pending.sessionKey, runId: 'tool-run', stream: 'tool' },
    };
    await stream.dispatchGatewayEvent(event);
    expect(stream.findPendingBySessionKey).toHaveBeenCalledWith(pending.sessionKey, 'tool-run', undefined);
    expect(agentEvents.handleAgentEvent).toHaveBeenCalledWith(event);
    expect(ambient.handleAgentEvent).not.toHaveBeenCalled();

    stream.findPendingBySessionKey.mockReturnValue(undefined);
    ambient.handleAgentEvent.mockResolvedValue(true);
    agentEvents.handleAgentEvent.mockClear();
    await stream.dispatchGatewayEvent(event);
    expect(ambient.handleAgentEvent).toHaveBeenCalledWith(event);
    expect(agentEvents.handleAgentEvent).not.toHaveBeenCalled();
  });

  it('projects agent and session-operation compaction events through the shared scoped projection', async () => {
    const { stream, pending, ambient, agentEvents } = loadDispatchHarness();
    const data = { phase: 'start', compactionId: 'cmp-preflight', source: 'preflight' };
    await stream.dispatchGatewayEvent({
      event: 'agent',
      payload: { sessionKey: pending.sessionKey, runId: 'recovered-run', resumedFromRunId: 'prompt-run', stream: 'compaction', data },
    });
    expect(stream.findPendingBySessionKey).toHaveBeenCalledWith(pending.sessionKey, 'recovered-run', 'prompt-run');
    expect(ambient.emitCompactionUpdate).toHaveBeenLastCalledWith(pending.sessionKey, 'recovered-run', data, pending);

    const operation = { sessionKey: pending.sessionKey, operation: 'compact', phase: 'end', compactionId: 'cmp-manual', source: 'manual', completed: true };
    await stream.dispatchGatewayEvent({ event: 'session.operation', payload: operation });
    expect(stream.findUniquePendingBySessionKey).toHaveBeenCalledWith(pending.sessionKey);
    expect(ambient.emitCompactionUpdate).toHaveBeenLastCalledWith(pending.sessionKey, undefined, operation, pending);
    expect(ambient.emitCompactionUpdate).toHaveBeenCalledTimes(2);
    expect(agentEvents.handleAgentEvent).not.toHaveBeenCalled();
  });

  it('forwards passive compaction to the scoped projector and ignores unrelated or malformed operations', async () => {
    const { stream, pending, ambient } = loadDispatchHarness();
    stream.findUniquePendingBySessionKey.mockReturnValue(undefined);
    const operation = { sessionKey: pending.sessionKey, operation: 'compact', phase: 'start', compactionId: 'cmp-passive', source: 'manual' };
    await stream.dispatchGatewayEvent({ event: 'session.operation', payload: operation });
    expect(ambient.emitCompactionUpdate).toHaveBeenCalledWith(pending.sessionKey, undefined, operation, undefined);

    await stream.dispatchGatewayEvent({ event: 'session.operation', payload: { ...operation, operation: 'reset' } });
    await stream.dispatchGatewayEvent({ event: 'session.operation', payload: { ...operation, sessionKey: ' ' } });
    await stream.dispatchGatewayEvent({ event: 'session.operation' });
    expect(ambient.emitCompactionUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the patched ACP chunk syntactically valid', async () => {
    await expect(execFileAsync(process.execPath, ['--check', path.join(dist, 'server-D2T0Amp5.mjs')]))
      .resolves.toMatchObject({ stderr: '' });
  });

  it('keeps the passive replay baseline across hidden controls while real user text resets it', () => {
    const names = ['extractReplayChunks', 'resolveAmbientReplayBaseline', 'toAcpReplayUpdate'];
    const declarations = names.map((name) => {
      const matches = [...bundle.matchAll(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))];
      expect(matches, name).toHaveLength(1);
      return matches[0][0];
    });
    const { resolveAmbientReplayBaseline } = runInNewContext(
      `${declarations.join('\n')}\n({ resolveAmbientReplayBaseline });`,
      {
        asOptionalRecord: (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined,
        normalizeOptionalString: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined,
      },
    ) as {
      resolveAmbientReplayBaseline: (events: unknown[], transcript: unknown[]) => { sentText?: string; sentThought?: string };
    };
    const assistant = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Already streamed' }, { type: 'thinking', thinking: 'Already considered' }],
    };
    const controlText = 'Continue the current task from the existing transcript.';
    for (const metadata of [
      { display: false },
      { provenance: { kind: 'internal_system' } },
      { inputProvenance: { kind: 'internal_system' } },
      { provenance: { kind: 'inter_session' } },
    ]) {
      const baseline = resolveAmbientReplayBaseline([], [assistant, { role: 'user', content: controlText, ...metadata }]);
      expect(baseline).toMatchObject({ sentText: 'Already streamed', sentThought: 'Already considered' });
    }
    const visibleBoundary = resolveAmbientReplayBaseline([], [assistant, {
      role: 'user', content: controlText, provenance: { kind: 'external_user' },
    }]);
    expect(visibleBoundary.sentText).toBeUndefined();
    expect(visibleBoundary.sentThought).toBeUndefined();
  });
});
