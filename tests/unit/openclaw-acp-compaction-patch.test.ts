// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const patchPath = path.join(root, 'patches/openclaw@2026.7.1-2.patch');

function patchForFile(patch: string, file: string): string {
  const marker = `diff --git a/${file} b/${file}`;
  const start = patch.indexOf(marker);
  if (start === -1) return '';
  const next = patch.indexOf('\ndiff --git ', start + marker.length);
  return patch.slice(start, next === -1 ? undefined : next);
}

function addedLinesForFile(patch: string, file: string): string {
  return patchForFile(patch, file)
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

describe('OpenClaw ACP compaction lifecycle patch', () => {
  let patch: string;
  let installedEmbedded: string;

  beforeAll(async () => {
    [patch, installedEmbedded] = await Promise.all([
      readFile(patchPath, 'utf8'),
      readFile(path.join(root, 'node_modules/openclaw/dist/embedded-agent-DGUuxGR2.js'), 'utf8'),
    ]);
  });

  it('projects structured live lifecycle events into recorded ACP metadata', () => {
    expect(patch).toContain('"openclaw.ai/compaction"');
    expect(patch).toContain('sessionUpdate: "session_info_update"');
    expect(patch).toContain('record: true');
    expect(patch).toContain('stream === "compaction"');
    expect(patch).toContain('status: phase === "start" ? "in_progress"');
    expect(patch).toContain('data.aborted === true ? "cancelled"');
    expect(patch).toContain('data.completed === true ? "completed" : "failed"');
  });

  it('gives each AgentSession occurrence a fresh id and reuses it at the end', () => {
    const selection = addedLinesForFile(patch, 'dist/selection-JInn13lc.js');

    expect(selection).toContain('function createCompactionId()');
    expect(selection).toContain('const compactionId = createCompactionId()');
    expect(selection).toContain('ctx.state.activeCompactionId = compactionId');
    expect(selection).toContain('const compactionId = ctx.state.activeCompactionId;');
    expect(selection).toContain('compaction end without matching start');
    expect(selection).not.toContain('activeCompactionId ?? createCompactionId()');
    expect(selection).toContain('ctx.state.activeCompactionId = void 0');
    expect(selection).toContain('source: reason');
    expect(selection).toContain('const timestamp = new Date().toISOString()');
    expect(selection).toContain('timestamp,');
    expect(selection).toContain('aborted: wasAborted');
    expect(selection).toContain('completed: hasResult && !wasAborted');
    expect(selection).not.toMatch(/completed: false,\s*willRetry:/);
  });

  it('instruments the actual ACP chat /compact command with one terminal per start', () => {
    const commands = addedLinesForFile(
      patch,
      'dist/commands-handlers.runtime-CunY89Nu.js',
    );
    const commandsPatch = patchForFile(
      patch,
      'dist/commands-handlers.runtime-CunY89Nu.js',
    );
    const compactCall = commands.indexOf('result = await runtime.compactEmbeddedAgentSession({');
    const terminalFinally = commands.indexOf('} finally {', compactCall);
    const terminalEvent = commands.indexOf('phase: "end"', terminalFinally);

    expect(commandsPatch).toMatch(/@@ .*handleCompactCommand = async \(params\) => \{/);
    expect(commands).toContain('const runId = params.opts?.runId;');
    expect(commands).toContain('const compactionId = `cmp-${crypto.randomUUID()}`;');
    expect(commands).toContain('runId,');
    expect(commands).toContain('sessionKey: params.sessionKey,');
    expect(commands).toContain('phase: "start"');
    expect(compactCall).toBeGreaterThan(commands.indexOf('phase: "start"'));
    expect(terminalFinally).toBeGreaterThan(compactCall);
    expect(terminalEvent).toBeGreaterThan(terminalFinally);
    expect(commands).toContain('params.opts?.abortSignal?.aborted === true');
    expect(commands).toContain('compactError?.name === "AbortError"');
    expect(commands).toContain('result?.reason === "aborted"');
    expect(commands).toContain('completed: result?.ok === true && result.compacted === true && !aborted');
    expect(commands).not.toMatch(/completed: false,\s*willRetry:/);
    expect(commands).not.toContain('summary:');
  });

  it('protects owning-engine and direct session-operation terminals', () => {
    const embedded = addedLinesForFile(patch, 'dist/embedded-agent-DGUuxGR2.js');
    const sessions = addedLinesForFile(patch, 'dist/sessions-UcKjjh_n.js');
    const directStart = embedded.indexOf(
      'const emitDirectCompactionStart = async (source) => {',
    );
    const directEnd = embedded.indexOf(
      '\n\t\t\t\tconst emitDirectCompactionEnd = async',
      directStart,
    );
    const beforeHookStart = installedEmbedded.indexOf(
      'const runOwnsCompactionBeforeHook = async (reason) => {',
    );
    const beforeHookEnd = installedEmbedded.indexOf(
      '\n\t\t\t\tconst runOwnsCompactionAfterHook = async',
      beforeHookStart,
    );
    const afterHookStart = beforeHookEnd;
    const afterHookEnd = installedEmbedded.indexOf(
      '\n\t\t\t\tlet authRetryPending',
      afterHookStart,
    );

    expect(directStart).toBeGreaterThanOrEqual(0);
    expect(directEnd).toBeGreaterThan(directStart);
    expect(beforeHookStart).toBeGreaterThanOrEqual(0);
    expect(beforeHookEnd).toBeGreaterThan(beforeHookStart);
    expect(afterHookEnd).toBeGreaterThan(afterHookStart);
    const emitDirectCompactionStart = embedded.slice(directStart, directEnd);
    const runOwnsCompactionBeforeHook = installedEmbedded.slice(
      beforeHookStart,
      beforeHookEnd,
    );
    const runOwnsCompactionAfterHook = installedEmbedded.slice(
      afterHookStart,
      afterHookEnd,
    );

    expect(runOwnsCompactionBeforeHook).toContain(
      'contextEngine.info.ownsCompaction !== true',
    );
    expect(runOwnsCompactionAfterHook).toContain(
      'contextEngine.info.ownsCompaction !== true',
    );
    expect(emitDirectCompactionStart).not.toContain('ownsCompaction');
    expect(embedded).toContain('timeoutCompactionId = await emitDirectCompactionStart("preflight")');
    expect(embedded).toContain('directCompactionId = await emitDirectCompactionStart(directCompactionSource)');
    expect(embedded).toContain(
      'const aborted = params.abortSignal?.aborted === true || compactResult?.reason === "aborted";',
    );
    expect(embedded.match(/reason: compactErr\?\.name === "AbortError" \? "aborted" : String\(compactErr\)/g)).toHaveLength(2);
    expect(embedded).toContain('} finally {\n\t\t\t\t\t\t\t\tawait emitDirectCompactionEnd(timeoutCompactionId');
    expect(embedded).toContain('} finally {\n\t\t\t\t\t\t\t\tawait emitDirectCompactionEnd(directCompactionId');
    expect(embedded).not.toMatch(/completed: false,\s*willRetry:/);
    expect(sessions).toContain('const compactionId = randomUUID()');
    expect(sessions).toContain('operation: "compact"');
    expect(sessions).toContain('source: "manual"');
    expect(sessions).toContain('const aborted =');
    expect(sessions).toContain('detail: detailText');
    expect(sessions).not.toMatch(/completed: false,\s*willRetry:/);
    expect(sessions).not.toMatch(/reason: "manual",[\s\S]{0,250}\breason\s*[,}]/);
    expect(sessions).toContain('getSessionMessageEventSubscriberConnIds');
  });

  it('owns scoped session-operation subscriptions for the full prompt lifetime', () => {
    const acp = addedLinesForFile(patch, 'dist/acp-cli-BXc5GttU.js');
    const acpPatch = patchForFile(patch, 'dist/acp-cli-BXc5GttU.js');
    const cancel = acp.indexOf('await this.cancelSessionWork(session);');
    const acquire = acp.indexOf('await this.acquireSessionMessageSubscription(session.sessionKey);');
    const ensureSubscription = acp.slice(
      acp.indexOf('async ensureSessionMessageSubscription(sessionKey, entry)'),
      acp.indexOf('async acquireSessionMessageSubscription(sessionKey)'),
    );
    const acquireSubscription = acp.slice(
      acp.indexOf('async acquireSessionMessageSubscription(sessionKey)'),
      acp.indexOf('async releaseSessionMessageSubscription(sessionKey)'),
    );
    const releaseSubscription = acp.slice(
      acp.indexOf('async releaseSessionMessageSubscription(sessionKey)'),
      acp.indexOf('async handleGatewayReconnect()'),
    );
    const reconnectSubscription = acp.slice(
      acp.indexOf('async handleGatewayReconnect()'),
      acp.indexOf('handleGatewayDisconnect(reason)'),
    );

    expect(acp).toContain('this.sessionMessageSubscriptions = /* @__PURE__ */ new Map();');
    expect(acp).toContain('async acquireSessionMessageSubscription(sessionKey)');
    expect(acp).toContain('async releaseSessionMessageSubscription(sessionKey)');
    expect(acp).toContain('async ensureSessionMessageSubscription(sessionKey, entry)');
    expect(acp).toContain('for (let attempt = 1; attempt <= 2; attempt++)');
    expect(cancel).toBeGreaterThanOrEqual(0);
    expect(acquire).toBeGreaterThan(cancel);
    expect(acp).toContain(
      'await this.acquireSessionMessageSubscription(session.sessionKey);\n\t\tthis.sessionStore.setActiveRun(params.sessionId, runId, abortController);',
    );
    expect(acpPatch).toContain(
      '-\t\tthis.sessionStore.setActiveRun(params.sessionId, runId, abortController);',
    );
    expect(ensureSubscription).toContain('let finalError;');
    expect(ensureSubscription).toContain('finalError = err;');
    expect(ensureSubscription).toContain('throw finalError;');
    expect(acquireSubscription).toContain('entry.refCount = Math.max(0, entry.refCount - 1);');
    expect(acquireSubscription).toContain('this.sessionMessageSubscriptions.delete(sessionKey);');
    expect(acquireSubscription).toContain('throw err;');
    expect(releaseSubscription).toContain('if (entry.acquirePromise) try {');
    expect(releaseSubscription).toContain('session message subscription cleanup failed');
    expect(reconnectSubscription).toContain('session message subscription recovery failed');
    expect(acp).toContain('void agent?.handleGatewayReconnect().catch((err) => {');
    expect(acp).toContain('this.gateway.request("sessions.messages.unsubscribe", { key: sessionKey })');
    expect(acp).toContain('this.releaseSessionMessageSubscription(pending.subscriptionSessionKey)');
    expect(acp).toContain('entry.subscribed = false;');
    expect(acp).toContain('this.ensureSessionMessageSubscription(sessionKey, entry)');
    expect(acp).toContain('evt.event === "session.operation"');
    expect(acp).toContain(
      'operationRunId ? this.findPendingBySessionKey(sessionKey, operationRunId)',
    );
    expect(acp).toContain('await this.emitCompactionUpdate(pending, payload, operationRunId);');
    expect(acp).not.toContain('operationRunId ?? pending.idempotencyKey');
    expect(acp).not.toContain('this.gateway.request("sessions.subscribe", {})');
  });

  it('replays durable transcript compaction markers in place without their summary', () => {
    expect(patch).toContain('message.__openclaw?.kind === "compaction"');
    expect(patch).toContain('compactionId: message.__openclaw.id');
    expect(patch).toContain('status: "completed"');
    expect(patch).toContain('source: "transcript"');
    expect(patch).toContain('sessionUpdate: "session_info_update"');
    expect(patch).not.toContain('+\t\t\tsummary: message');
  });
});
