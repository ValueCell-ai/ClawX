// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');
const execFileAsync = promisify(execFile);

const OPENCLAW_VERSION = '2026.10.5';
const PATCH_PATH = `patches/openclaw@${OPENCLAW_VERSION}.patch`;

describe('OpenClaw restart recovery contract', () => {
  it('registers the pinned 2026.10.5 runtime patch through the pnpm workspace', async () => {
    const workspace = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    const patch = await readFile(path.join(root, PATCH_PATH));
    const patchHash = createHash('sha256').update(patch).digest('hex');

    expect(workspace).toContain(`openclaw@${OPENCLAW_VERSION}: ${PATCH_PATH}`);
    expect(lockfile).toContain(`path: ${PATCH_PATH}`);
    expect(lockfile).toContain(`hash: ${patchHash}`);
  });

  it('relies on the upstream 2026.10.5 restart-recovery lineage and admission path', async () => {
    // Upstream 2026.10.5 ships the recovery work ClawX previously backported:
    // startup orphan marking, interrupted-run lineage, and recovery admission
    // provenance. The ClawX patch must not duplicate it.
    const [preflight, lifecycle, marking] = await Promise.all([
      readFile(path.join(dist, 'agent-request-preflight-f94DZoO_.mjs'), 'utf8'),
      readFile(path.join(dist, 'main-session-restart-recovery-Xw9O4XVI.mjs'), 'utf8'),
      readFile(path.join(dist, 'main-session-restart-recovery-marking-zFjz6Dha.mjs'), 'utf8'),
    ]);

    expect(preflight).toContain('isMainSessionRestartRecoveryInputProvenance');
    expect(preflight).toContain('internal execution identity recovery fields are reserved for main-session restart recovery');
    expect(lifecycle).toContain('restartRecoveryDeliverySourceRunId = sourceRunId');
    expect(lifecycle).toContain('function readInterruptedRunId');
    expect(lifecycle).toContain('internalExecutionIdentityRecoveryAttempt');
    expect(lifecycle).toContain('sourceTool: MAIN_SESSION_RESTART_RECOVERY_SOURCE_TOOL');
    expect(marking).toContain('async function markStartupOrphanedMainSessionsForRecovery');
    expect(marking).toContain('entry.lifecycleRunId');

    const patch = await readFile(path.join(root, PATCH_PATH), 'utf8');
    expect(patch).not.toContain('internalRestartRecoverySourceRunId');
    expect(patch).not.toContain('resolvePersistedAgentWaitSnapshot');
  });

  it('executes the ClawX transcript fallback as ordered native ACP replay updates', async () => {
    const bundle = await readFile(path.join(dist, 'server-DkfYuk25.mjs'), 'utf8');
    const replayStart = bundle.indexOf('function extractToolResultReplay(message)');
    const end = bundle.indexOf('//#endregion', replayStart);
    expect(replayStart).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(replayStart);

    const context = {
      normalizeOptionalString: (value: unknown) => (
        typeof value === 'string' && value.trim() ? value.trim() : undefined
      ),
      asOptionalRecord: (value: unknown) => (
        value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown>
          : undefined
      ),
      formatToolTitle: (name: string | undefined) => name ?? 'tool',
      inferToolKind: () => 'other',
      extractToolCallLocations: () => undefined,
      extractToolCallContent: (value: unknown) => (
        typeof value === 'string'
          ? [{ type: 'content', content: { type: 'text', text: value } }]
          : undefined
      ),
      timestampMsToIsoString: () => undefined,
      extractReplayChunks: undefined as ((message: Record<string, unknown>) => unknown[]) | undefined,
    };
    runInNewContext(
      `${bundle.slice(replayStart, end)}\nglobalThis.extractReplayChunks = extractReplayChunks;`,
      context,
    );
    const extractReplayChunks = context.extractReplayChunks;
    expect(extractReplayChunks).toBeTypeOf('function');

    expect(extractReplayChunks?.({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Before tool' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/app.ts' } },
        { type: 'text', text: 'After tool' },
      ],
    })).toEqual([
      { sessionUpdate: 'agent_message_chunk', text: 'Before tool' },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'read',
        status: 'in_progress',
        rawInput: { path: 'src/app.ts' },
        kind: 'other',
        locations: undefined,
      },
      { sessionUpdate: 'agent_message_chunk', text: 'After tool' },
    ]);

    expect(extractReplayChunks?.({
      role: 'toolResult',
      toolCallId: 'call-1',
      content: 'plain tool output',
    })).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        rawOutput: { content: 'plain tool output' },
        content: [{ type: 'content', content: { type: 'text', text: 'plain tool output' } }],
        locations: undefined,
      },
    ]);

    expect(extractReplayChunks?.({
      role: 'assistant',
      timestamp: 1_700_000_000_000,
      __openclaw: { kind: 'compaction', id: 'cmp-replay' },
      content: [],
    })).toEqual([
      {
        sessionUpdate: 'session_info_update',
        _meta: {
          'openclaw.ai/compaction': {
            version: 1,
            compactionId: 'cmp-replay',
            status: 'completed',
            source: 'transcript',
          },
        },
      },
    ]);
  });

  it('keeps every patched runtime chunk syntactically valid', async () => {
    const patch = await readFile(path.join(root, PATCH_PATH), 'utf8');
    const files = [...patch.matchAll(/^diff --git a\/(dist\/[^ ]+) b\//gm)].map((match) => match[1]);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      await expect(execFileAsync(process.execPath, [
        '--check',
        path.join(root, 'node_modules/openclaw', file),
      ])).resolves.toMatchObject({ stderr: '' });
    }
  });
});
