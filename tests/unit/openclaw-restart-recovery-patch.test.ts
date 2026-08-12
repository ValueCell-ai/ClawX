// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

function assertValidUnifiedDiffHunks(patch: string): void {
  const lines = patch.split('\n');
  let hunkCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(lines[index] ?? '');
    if (!header) continue;

    hunkCount += 1;
    const expectedOld = Number(header[1] ?? 1);
    const expectedNew = Number(header[2] ?? 1);
    let oldLines = 0;
    let newLines = 0;

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.startsWith('@@ ') || line.startsWith('diff --git ')) {
        index -= 1;
        break;
      }
      if (line === '' && index === lines.length - 1) break;
      if (line.startsWith(' ')) {
        oldLines += 1;
        newLines += 1;
      } else if (line.startsWith('-')) {
        oldLines += 1;
      } else if (line.startsWith('+')) {
        newLines += 1;
      } else if (!line.startsWith('\\')) {
        throw new Error(`Invalid unified diff line ${index + 1}: ${line}`);
      }
    }

    expect({ oldLines, newLines }).toEqual({
      oldLines: expectedOld,
      newLines: expectedNew,
    });
  }

  expect(hunkCount).toBeGreaterThan(0);
}

describe('OpenClaw restart recovery patch', () => {
  it('registers the pinned runtime patch through the pnpm workspace', async () => {
    const workspace = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    const patch = await readFile(path.join(root, 'patches/openclaw@2026.7.1-2.patch'));
    const patchHash = createHash('sha256').update(patch).digest('hex');

    expect(workspace).toContain(
      'openclaw@2026.7.1-2: patches/openclaw@2026.7.1-2.patch',
    );
    expect(lockfile).toContain(`hash: ${patchHash}`);
    expect(lockfile).toContain('path: patches/openclaw@2026.7.1-2.patch');
  });

  it('carries trusted recovery lineage through Gateway events into ACP', async () => {
    const patch = await readFile(
      path.join(root, 'patches/openclaw@2026.7.1-2.patch'),
      'utf8',
    );

    expect(patch).toContain('internalRestartRecoverySourceRunId');
    expect(patch).toContain('canUseInternalRuntimeHandoff && inputProvenance?.kind');
    expect(patch).toContain('resumedFromRunId');
    expect(patch).toContain('pending.sendAccepted = true');
    expect(patch).toContain('pending.disconnectContext = void 0');
    expect(patch).toContain('ACP_GATEWAY_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = 6e4');
    expect(patch).toContain('deadline === "accepted-recovery"');
    expect(patch).toContain('const waitedRunId = pending.idempotencyKey');
    expect(patch).toContain('status: "failed"');
    expect(patch).toContain('getAgentRunContext(requestRunId)?.resumedFromRunId');
    expect(patch).toContain('runId: params.runId');
    expect(patch).toContain('runId: options?.runId');
    expect(patch).toContain('execute: async (toolCallId, args, signal, onUpdate)');
    expect(patch).toContain('runId: defaults?.runId');
    expect(patch).toContain('runId: Type.Optional(Type.Union([Type.String(), Type.Null()]))');
    expect(patch).toContain('toolCallId: params.toolCallId');
    expect(patch).toContain('restart recovery must use a distinct run id');
    expect(patch).toContain('entry.restartRecoveryDeliverySourceRunId = sourceRunId');
    expect(patch).not.toContain('!entry.restartRecoveryDeliverySourceRunId && sourceRunId');
    expect(patch).toContain('normalizeOptionalString(params.entry.restartRecoveryDeliverySourceRunId)');
    expect(patch).toContain('phase === "start" ? { lifecycleRunId: runId }');
    expect(patch).toContain('lifecycleRunId: _lifecycleRunId');
    expect(patch).toContain('this.gateway.request("sessions.messages.subscribe", { key: pending.sessionKey })');
    expect(patch).not.toContain('this.gateway.request("sessions.subscribe", {})');
    expect(patch).toContain('evt.event === "session.tool"');
    expect(patch).not.toContain('diff --git a/scripts/README.md');
    assertValidUnifiedDiffHunks(patch);
  });

  it('preserves recovered tool boundaries in live delivery and transcript replay', async () => {
    const patch = await readFile(
      path.join(root, 'patches/openclaw@2026.7.1-2.patch'),
      'utf8',
    );

    expect(patch).toContain('const resumedFromRunId = runContext?.resumedFromRunId');
    expect(patch).toContain('...sessionMessageSubscribers.get(resolveSessionDeliveryKey(sessionKey, sessionAgentId))');
    expect(patch).toContain('function extractToolResultReplay(message)');
    expect(patch).toContain('extractToolCallContent(message.content)');
    expect(patch).toContain('typedBlock.type === "toolCall"');
    expect(patch).toContain('sessionUpdate: "tool_call_update"');
    expect(patch).toContain('chunk.sessionUpdate === "user_message_chunk"');
    expect(patch).toContain('const subscriptionReady = Promise.all');
    expect(patch).toContain('subscriptionReady.then(() => this.reconcilePendingPrompts');
  });

  it('executes the pinned transcript fallback as ordered native ACP updates', async () => {
    const bundle = await readFile(
      path.join(root, 'node_modules/openclaw/dist/acp-cli-BXc5GttU.js'),
      'utf8',
    );
    const start = bundle.indexOf('function extractToolResultReplay(message)');
    const end = bundle.indexOf('//#endregion', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

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
      extractReplayChunks: undefined as ((message: Record<string, unknown>) => unknown[]) | undefined,
    };
    runInNewContext(
      `${bundle.slice(start, end)}\nglobalThis.extractReplayChunks = extractReplayChunks;`,
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
  });

  it('passes execution identity through the pinned approval request builder', async () => {
    const bundle = await readFile(
      path.join(root, 'node_modules/openclaw/dist/bash-tools-DHyGpWCr.js'),
      'utf8',
    );
    const start = bundle.indexOf('function buildExecApprovalRequestToolParams(params)');
    const end = bundle.indexOf('\nfunction parseDecision', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const context = {
      DEFAULT_APPROVAL_TIMEOUT_MS: 60_000,
      buildExecApprovalRequestToolParams: undefined as ((params: Record<string, unknown>) => Record<string, unknown>) | undefined,
    };
    runInNewContext(
      `${bundle.slice(start, end)}\nglobalThis.buildExecApprovalRequestToolParams = buildExecApprovalRequestToolParams;`,
      context,
    );

    expect(context.buildExecApprovalRequestToolParams?.({
      id: 'approval-1',
      sessionId: 'session-1',
      runId: 'recovery-run',
      toolCallId: 'tool-1',
    })).toMatchObject({
      id: 'approval-1',
      sessionId: 'session-1',
      runId: 'recovery-run',
      toolCallId: 'tool-1',
      timeoutMs: 60_000,
      twoPhase: true,
    });
  });

  it('keeps all patched runtime chunks syntactically valid', async () => {
    for (const file of [
      'agent-tools-BD8WL7ny.js',
      'bash-tools-DHyGpWCr.js',
      'exec-approval-DRfKKxhu.js',
      'schema-BuOFpc7K.js',
    ]) {
      await expect(execFileAsync(process.execPath, [
        '--check',
        path.join(root, 'node_modules/openclaw/dist', file),
      ])).resolves.toMatchObject({ stderr: '' });
    }
  });
});
