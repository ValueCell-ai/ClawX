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
const execFileAsync = promisify(execFile);

type DeltaHandler = (this: {
  pendingPrompts: Map<string, Record<string, unknown>>;
  sessionUpdates: { emit: (value: unknown) => Promise<void> };
}, sessionId: string, messageData: Record<string, unknown>) => Promise<void>;

type ChatHandler = (this: {
  findPendingBySessionKey: () => Record<string, unknown> | undefined;
  handleDeltaEvent: (sessionId: string, messageData: Record<string, unknown>) => Promise<void>;
  finishPrompt: (sessionId: string, pending: Record<string, unknown>, stopReason: string) => Promise<void>;
}, event: { payload: Record<string, unknown> }) => Promise<void>;

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

describe('OpenClaw ACP assistant stream patch', () => {
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
