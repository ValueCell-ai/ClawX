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
    bundle = await readFile(path.join(dist, 'server-DkfYuk25.mjs'), 'utf8');
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
      globalThis.resolveAcpTextDelta = resolveAcpTextDelta;`,
      context,
    );
    return context as {
      resolveAcpEventTextSnapshot: (previous: string, data: { text?: string; delta?: string }) => string;
      resolveAcpTextDelta: (previous: string, next: string) => string;
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

  it('uses the snapshot-aware delta in the prompt text and thought streams', () => {
    const start = bundle.indexOf('async handleDeltaEvent(pending, messageData)');
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
    await expect(execFileAsync(process.execPath, ['--check', path.join(dist, 'server-DkfYuk25.mjs')]))
      .resolves.toMatchObject({ stderr: '' });
  });
});
