// @vitest-environment node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

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

  it('dispatches session.tool and session.operation events through the prompt stream', () => {
    expect(bundle).toContain('evt.event === "agent" || evt.event === "session.tool"');
    expect(bundle).toContain('evt.event === "session.operation"');
    expect(bundle).toContain('async handleSessionOperationEvent(evt)');
    expect(bundle).toContain('buildAcpCompactionUpdate(payload, operationRunId)');
  });

  it('keeps the patched ACP chunk syntactically valid', async () => {
    await expect(execFileAsync(process.execPath, ['--check', path.join(dist, 'server-DkfYuk25.mjs')]))
      .resolves.toMatchObject({ stderr: '' });
  });
});
