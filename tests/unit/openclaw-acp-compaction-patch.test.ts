// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');
const patchPath = path.join(root, 'patches/openclaw@2026.10.5.patch');

describe('OpenClaw ACP compaction lifecycle patch', () => {
  let patch: string;
  let installedAcp: string;
  let installedEmbedded: string;
  let installedSessions: string;

  beforeAll(async () => {
    [patch, installedAcp, installedEmbedded, installedSessions] = await Promise.all([
      readFile(patchPath, 'utf8'),
      readFile(path.join(dist, 'server-DkfYuk25.mjs'), 'utf8'),
      readFile(path.join(dist, 'builtin-openclaw-CLelpwAr.mjs'), 'utf8'),
      readFile(path.join(dist, 'sessions-compact-BHqjQkq-.mjs'), 'utf8'),
    ]);
  });

  it('projects a stable code and bounded explanation for failed compactions', () => {
    const start = installedAcp.indexOf('const ACP_COMPACTION_SOURCES =');
    const end = installedAcp.indexOf('function extractReplayChunks(message)');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const context = {
      normalizeOptionalString: (value: unknown) => (
        typeof value === 'string' && value.trim() ? value.trim() : undefined
      ),
      timestampMsToIsoString: () => undefined,
    } as Record<string, unknown>;
    vm.runInNewContext(
      `${installedAcp.slice(start, end)}\nglobalThis.buildAcpCompactionUpdate = buildAcpCompactionUpdate;`,
      context,
    );
    const buildAcpCompactionUpdate = context.buildAcpCompactionUpdate as (
      data: Record<string, unknown>,
      runId: string,
    ) => Record<string, unknown>;

    const update = buildAcpCompactionUpdate({
      phase: 'end',
      compactionId: 'cmp-pressure',
      source: 'preflight',
      completed: false,
      aborted: false,
      reasonCode: 'no_compactable_entries',
      failureReason: '  no real conversation messages  ',
    }, 'run-pressure');

    expect(update).toEqual({
      sessionUpdate: 'session_info_update',
      _meta: {
        'openclaw.ai/compaction': {
          version: 1,
          compactionId: 'cmp-pressure',
          status: 'failed',
          source: 'preflight',
          runId: 'run-pressure',
          reasonCode: 'no_compactable_entries',
          reason: 'no real conversation messages',
        },
      },
    });

    const boundedUpdate = buildAcpCompactionUpdate({
      phase: 'end',
      compactionId: 'cmp-long-reason',
      source: 'preflight',
      completed: false,
      aborted: false,
      failureReason: 'x'.repeat(1_000),
    }, 'run-pressure') as { _meta: { 'openclaw.ai/compaction': { reason: string } } };
    expect(boundedUpdate._meta['openclaw.ai/compaction'].reason).toHaveLength(500);

    expect(buildAcpCompactionUpdate({
      phase: 'start',
      compactionId: 'cmp-start',
      source: 'manual',
    }, 'run-start')).toMatchObject({
      _meta: {
        'openclaw.ai/compaction': {
          compactionId: 'cmp-start',
          status: 'in_progress',
          source: 'manual',
        },
      },
    });
    expect(buildAcpCompactionUpdate({ phase: 'start', source: 'manual' }, 'missing-id')).toBeUndefined();
  });

  it('streams compaction lifecycle events into recorded ACP metadata', () => {
    expect(patch).toContain('"openclaw.ai/compaction"');
    expect(patch).toContain('sessionUpdate: "session_info_update"');
    expect(patch).toContain('stream === "compaction"');
    expect(patch).toContain('const status = phase === "start" ? "in_progress"');
    expect(patch).toContain('data.aborted === true ? "cancelled"');
    expect(patch).toContain('data.completed === true ? "completed" : "failed"');
    expect(patch).toContain('evt.event === "session.operation"');
    expect(patch).toContain('handleSessionOperationEvent');
    expect(patch).toContain('buildAcpCompactionUpdate(data, runId)');
    expect(patch).toContain('sessionUpdate: "session_info_update"');
  });

  it('gives each embedded compaction a fresh id that the end event reuses', () => {
    const start = installedEmbedded.indexOf('function handleCompactionStart(ctx, evt)');
    const end = installedEmbedded.indexOf('function handleCompactionEnd(ctx, evt)', start);
    const endEnd = installedEmbedded.indexOf('//#endregion', end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const startSource = installedEmbedded.slice(start, end);
    const endSource = installedEmbedded.slice(end, endEnd);

    expect(startSource).toContain('const compactionId = `cmp-');
    expect(startSource).toContain('ctx.state.activeCompactionId = compactionId');
    expect(startSource).toContain('source: reason');
    expect(startSource).toContain('const timestamp = new Date().toISOString()');
    expect(startSource).toContain('aborted: false');
    expect(startSource).toContain('completed: false');
    expect(endSource).toContain('const compactionId = ctx.state.activeCompactionId');
    expect(endSource).toContain('ctx.state.activeCompactionId = void 0');
    expect(endSource).toContain('aborted: outcome.status === "aborted"');
    expect(endSource).toContain('completed,');
  });

  it('carries the manual compaction identity through session.operation metadata', () => {
    expect(patch).toContain('const compactionId = randomUUID()');
    expect(patch).toContain('operation: "compact"');
    expect(patch).toContain('source: "manual"');
    expect(patch).toContain('const aborted =');
    expect(patch).toContain('detail: detailText');
    expect(patch).not.toContain('completed: false, willRetry:');
    expect(installedSessions).toContain('const compactionId = randomUUID()');
    expect(installedSessions).toContain('classifyCompactionReason(detailText)');
  });
});
