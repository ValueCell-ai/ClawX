// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
    expect(patch).toContain('OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS');
    expect(patch).toContain('ACP_GATEWAY_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = Number.parseInt(process.env.OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS ?? "", 10) || 6e5');
    expect(patch).not.toContain('ACP_GATEWAY_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = Math.max');
    expect(patch).not.toContain('ACP_GATEWAY_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = 6e4');
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
    expect(patch).toContain('const sourceRunId = normalizeOptionalString(entry.lifecycleRunId)');
    expect(patch).toContain('entry.restartRecoveryDeliverySourceRunId = sourceRunId');
    expect(patch).not.toContain('normalizeOptionalString(entry.restartRecoveryDeliverySourceRunId) ?? normalizeOptionalString(entry.lifecycleRunId)');
    expect(patch).toContain('normalizeOptionalString(params.entry.restartRecoveryDeliverySourceRunId)');
    expect(patch).toContain('phase === "start" ? { lifecycleRunId: runId }');
    expect(patch).not.toContain('lifecycleRunId: void 0');
    expect(patch).toContain('lifecycleRunId: _lifecycleRunId');
    expect(patch).toContain('sessionKey: pending.sessionKey');
    expect(patch).toContain('normalizeOptionalString(entry?.lifecycleRunId) !== runId');
    expect(patch).toContain('sessionKey?: string | undefined');
    expect(patch).toContain('restartRecoveryDeliverySourceRunId?: string');
    expect(patch).toContain('this.ensureSessionMessageSubscription(sessionKey, entry)');
    expect(patch).toContain('this.gateway.request("sessions.messages.subscribe", { key: sessionKey })');
    expect(patch).not.toContain('this.gateway.request("sessions.subscribe", {})');
    expect(patch).toContain('evt.event === "session.tool"');
    expect(patch).not.toContain('diff --git a/scripts/README.md');
    assertValidUnifiedDiffHunks(patch);
  });

  it('settles agent.wait from the terminal session owned by the requested run after restart', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'clawx-restart-settlement-'));
    const sessionsDir = path.join(stateDir, 'agents', 'main', 'sessions');
    const storePath = path.join(sessionsDir, 'sessions.json');
    const sessionKey = 'agent:main:restart-settlement';
    const timeoutSessionKey = 'agent:main:restart-timeout';
    const killedSessionKey = 'agent:main:restart-killed';
    const doneSessionKey = 'agent:main:restart-done';
    const wrongSessionKey = 'agent:main:wrong-restart-owner';
    const recoveryRunId = 'bcd8a184-7232-4fae-9015-5b5e4fbfc07e';
    const timeoutRunId = '72dd001e-4111-4fac-8b08-8d94d01926c0';
    const killedRunId = '725d9946-18b8-44a2-a665-e1c7ce40536a';
    const doneRunId = '8a9b2bd5-dd42-4f47-9919-6c02a5306268';

    await mkdir(sessionsDir, { recursive: true });
    await writeFile(storePath, JSON.stringify({
      [sessionKey]: {
        sessionId: 'session-restart-settlement',
        status: 'failed',
        abortedLastRun: true,
        updatedAt: 1,
        lifecycleRunId: recoveryRunId,
        restartRecoveryDeliverySourceRunId: recoveryRunId,
      },
      [timeoutSessionKey]: {
        sessionId: 'session-restart-timeout',
        status: 'timeout',
        abortedLastRun: true,
        updatedAt: 2,
        lifecycleRunId: timeoutRunId,
      },
      [killedSessionKey]: {
        sessionId: 'session-restart-killed',
        status: 'killed',
        abortedLastRun: true,
        updatedAt: 3,
        lifecycleRunId: killedRunId,
      },
      [doneSessionKey]: {
        sessionId: 'session-restart-done',
        status: 'done',
        abortedLastRun: false,
        updatedAt: 4,
        lifecycleRunId: doneRunId,
      },
      [wrongSessionKey]: {
        sessionId: 'session-wrong-restart-owner',
        status: 'done',
        abortedLastRun: false,
        updatedAt: 5,
        lifecycleRunId: 'different-run',
      },
    }));

    try {
      const runtimePath = path.join(
        root,
        'node_modules/openclaw/dist/agent-D6kiZtPt.js',
      );
      const childScript = `
        import { pathToFileURL } from 'node:url';
        const runtime = await import(pathToFileURL(${JSON.stringify(runtimePath)}).href);
        const handlers = runtime.agentHandlers ?? runtime.a;
        const callWait = (runId, sessionKey) => new Promise((resolve) => {
          handlers['agent.wait']({
            params: { runId, sessionKey, timeoutMs: 0 },
            context: { chatAbortControllers: new Map(), dedupe: new Map() },
            respond: (ok, payload, error) => resolve({ ok, payload, error }),
          });
        });
        const matching = await callWait(${JSON.stringify(recoveryRunId)}, ${JSON.stringify(sessionKey)});
        const timeout = await callWait(${JSON.stringify(timeoutRunId)}, ${JSON.stringify(timeoutSessionKey)});
        const killed = await callWait(${JSON.stringify(killedRunId)}, ${JSON.stringify(killedSessionKey)});
        const done = await callWait(${JSON.stringify(doneRunId)}, ${JSON.stringify(doneSessionKey)});
        const unrelatedRun = await callWait('unrelated-run', ${JSON.stringify(sessionKey)});
        const unrelatedSession = await callWait(${JSON.stringify(recoveryRunId)}, ${JSON.stringify(wrongSessionKey)});
        process.stdout.write(JSON.stringify({ matching, timeout, killed, done, unrelatedRun, unrelatedSession }));
      `;
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', childScript], {
        env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
      });
      const result = JSON.parse(stdout) as {
        matching: { ok: boolean; payload?: { runId?: string; status?: string } };
        timeout: { ok: boolean; payload?: { runId?: string; status?: string } };
        killed: { ok: boolean; payload?: { runId?: string; status?: string } };
        done: { ok: boolean; payload?: { runId?: string; status?: string } };
        unrelatedRun: { ok: boolean; payload?: { runId?: string; status?: string } };
        unrelatedSession: { ok: boolean; payload?: { runId?: string; status?: string } };
      };
      expect(result.matching).toMatchObject({
        ok: true,
        payload: { runId: recoveryRunId, status: 'error' },
      });
      expect(result.timeout).toMatchObject({
        ok: true,
        payload: { runId: timeoutRunId, status: 'error' },
      });
      expect(result.killed).toMatchObject({
        ok: true,
        payload: { runId: killedRunId, status: 'error' },
      });
      expect(result.done).toMatchObject({
        ok: true,
        payload: { runId: doneRunId, status: 'ok' },
      });
      expect(result.unrelatedRun).toMatchObject({
        ok: true,
        payload: { runId: 'unrelated-run', status: 'timeout' },
      });
      expect(result.unrelatedSession).toMatchObject({
        ok: true,
        payload: { runId: recoveryRunId, status: 'timeout' },
      });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('links each recovery run to its directly interrupted predecessor', async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'clawx-direct-restart-lineage-'));
    const sessionsDir = path.join(stateDir, 'agents', 'main', 'sessions');
    const storePath = path.join(sessionsDir, 'sessions.json');
    const sessionKey = 'agent:main:direct-restart-lineage';
    const originalRunId = '3cb9d54f-e999-458b-9bdc-8955e428e511';
    const recoveryRunId = 'bcd8a184-7232-4fae-9015-5b5e4fbfc07e';

    await mkdir(sessionsDir, { recursive: true });
    await writeFile(storePath, JSON.stringify({
      [sessionKey]: {
        sessionId: 'session-direct-restart-lineage',
        status: 'running',
        abortedLastRun: false,
        updatedAt: 1,
        lifecycleRunId: recoveryRunId,
        restartRecoveryDeliverySourceRunId: originalRunId,
        restartRecoveryRuns: [{
          runId: originalRunId,
          lifecycleGeneration: 'previous-gateway',
        }],
      },
    }));

    try {
      const runtimePath = path.join(
        root,
        'node_modules/openclaw/dist/main-session-restart-recovery-Ce8fihTV.js',
      );
      const runtime = await import(pathToFileURL(runtimePath).href) as {
        r: (input: {
          stateDir: string;
          activeSessionIds: string[];
          activeSessionKeys: string[];
          updatedBeforeMs: number;
        }) => Promise<{ marked: number }>;
      };

      await expect(runtime.r({
        stateDir,
        activeSessionIds: [],
        activeSessionKeys: [],
        updatedBeforeMs: Date.now(),
      })).resolves.toMatchObject({ marked: 1 });

      const store = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, {
        restartRecoveryDeliverySourceRunId?: string;
        restartRecoveryRuns?: unknown[];
      }>;
      expect(store[sessionKey]?.restartRecoveryDeliverySourceRunId).toBe(recoveryRunId);
      expect(store[sessionKey]?.restartRecoveryRuns).toBeUndefined();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('prefers a guarded restart marker over older persisted recovery lineage', async () => {
    const bundle = await readFile(
      path.join(root, 'node_modules/openclaw/dist/main-session-restart-recovery-Ce8fihTV.js'),
      'utf8',
    );
    const start = bundle.indexOf('async function resumeMainSession(params)');
    const end = bundle.indexOf('\nasync function markRestartAbortedMainSessionsFromLocks', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    let request: { params?: { internalRestartRecoverySourceRunId?: string } } | undefined;
    const context = {
      sanitizePendingFinalDeliveryText: (value: string) => value,
      normalizeOptionalString: (value: unknown) => (
        typeof value === 'string' && value.trim() ? value.trim() : undefined
      ),
      buildResumeMessage: () => 'resume',
      resolveRestartRecoveryDeliveryContext: () => undefined,
      crypto: { randomUUID: () => 'next-recovery-run' },
      callGateway: async (value: { params?: { internalRestartRecoverySourceRunId?: string } }) => {
        request = value;
        return { runId: 'next-recovery-run' };
      },
      applyRestartRecoveryLifecycle: async () => undefined,
      log: { info: () => undefined, warn: () => undefined },
      resumeMainSession: undefined as ((params: Record<string, unknown>) => Promise<boolean>) | undefined,
    };
    runInNewContext(
      `${bundle.slice(start, end)}\nglobalThis.resumeMainSession = resumeMainSession;`,
      context,
    );

    await expect(context.resumeMainSession?.({
      entry: {
        sessionId: 'session-guarded-restart-lineage',
        restartRecoveryDeliverySourceRunId: 'original-run',
        restartRecoveryRuns: [{
          runId: 'current-recovery-run',
          lifecycleGeneration: 'previous-gateway',
        }],
      },
      storePath: '/tmp/sessions.json',
      sessionKey: 'agent:main:guarded-restart-lineage',
    })).resolves.toBe(true);
    expect(request?.params?.internalRestartRecoverySourceRunId).toBe('current-recovery-run');
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
    expect(patch).toContain('async handleGatewayReconnect()');
    expect(patch).toContain('session message subscription recovery failed');
    expect(patch).toContain('if (disconnectContext) await this.reconcilePendingPrompts');
  });

  it('retries the final ACP usage snapshot when a new session reports zero tokens', async () => {
    const patch = await readFile(
      path.join(root, 'patches/openclaw@2026.7.1-2.patch'),
      'utf8',
    );

    expect(patch).toContain('!sessionSnapshot.usage || sessionSnapshot.usage.used === 0');
    expect(patch).toContain('setTimeout(resolve, 1e3)');
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
