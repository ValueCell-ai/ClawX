import { describe, expect, it } from 'vitest';
import {
  classifyGatewayStderrMessage,
  GatewayStartupTraceCollector,
  parseGatewayStartupPhaseStart,
  parseGatewayStartupTraceStage,
} from '@electron/gateway/startup-stderr';

describe('Gateway startup stderr diagnostics', () => {
  it('parses OpenClaw CLI startup timing lines', () => {
    expect(parseGatewayStartupTraceStage(
      '[gateway] startup trace: cli.server-import 209842.7ms total=210114.3ms',
    )).toEqual({
      name: 'cli.server-import',
      durationMs: 209842.7,
      totalMs: 210114.3,
    });
  });

  it('parses timestamped runtime startup timing lines', () => {
    expect(parseGatewayStartupTraceStage(
      '2026-07-22T12:50:31.353+08:00 [gateway] startup trace: plugins.bootstrap 38124.5ms total=40102.2ms loadedPluginCount=4',
    )).toEqual({
      name: 'plugins.bootstrap',
      durationMs: 38124.5,
      totalMs: 40102.2,
    });
  });

  it('leaves duration-free detail traces unparsed but classifies them as info', () => {
    const line = '[gateway] startup trace: plugins.lookup-table startupPluginCount=4';

    expect(parseGatewayStartupTraceStage(line)).toBeNull();
    expect(classifyGatewayStderrMessage(line)).toEqual({
      level: 'info',
      normalized: line,
    });
  });

  it('summarizes the latest and slowest duration-bearing stages', () => {
    const collector = new GatewayStartupTraceCollector();

    collector.record('[gateway] startup trace: cli.config-snapshot 12.5ms total=15ms');
    collector.record('[gateway] startup trace: cli.server-import 30001.2ms total=30020ms');
    collector.record('[gateway] startup trace: runtime.config 20ms total=30040ms');
    // OpenClaw starts a new trace clock after importing the server runtime.
    // The summary must not replace the useful outer total with this smaller value.
    collector.record('[gateway] startup trace: gateway.server-impl-import 457.4ms total=457.4ms');

    expect(collector.getSummary()).toEqual({
      stageCount: 4,
      lastStage: 'gateway.server-impl-import',
      traceTotalMs: 30040,
      slowestStage: 'cli.server-import',
      slowestStageMs: 30001.2,
    });

    collector.reset();
    expect(collector.getSummary()).toEqual({ stageCount: 0 });
  });

  it('retains a started phase when it has not emitted a completion trace', () => {
    const collector = new GatewayStartupTraceCollector();
    const phase = '\u001B[33m[gateway] startup phase: gateway.server-start-import starting total=70049ms\u001B[39m';

    expect(parseGatewayStartupPhaseStart(phase)).toEqual({ name: 'gateway.server-start-import', totalMs: 70049 });
    expect(classifyGatewayStderrMessage(phase).level).toBe('info');
    expect(collector.record(phase, 1_000)).toBeNull();
    expect(collector.getProgress(31_000)).toEqual({
      lastStartedStage: 'gateway.server-start-import',
      lastStartedAt: 1_000,
      lastProgressAt: 1_000,
      silenceMs: 30_000,
    });
    expect(collector.getSummary()).toEqual({ stageCount: 0 });

    collector.record('unrelated warning', 31_000);
    expect(collector.getProgress(32_000).silenceMs).toBe(31_000);
  });

  it('records completion separately without claiming the last started phase remains active', () => {
    const collector = new GatewayStartupTraceCollector();
    collector.record('startup phase: cli.bootstrap starting total=10ms', 1_000);
    collector.record('startup phase: cli.bootstrap.child starting total=20ms', 1_100);
    collector.record('startup trace: cli.bootstrap.child 5ms total=25ms', 1_200);
    collector.record('startup trace: cli.bootstrap 15ms total=25ms', 1_300);

    expect(collector.getProgress(2_000)).toEqual({
      lastStartedStage: 'cli.bootstrap.child',
      lastStartedAt: 1_100,
      lastCompletedStage: 'cli.bootstrap',
      lastCompletedAt: 1_300,
      lastProgressAt: 1_300,
      silenceMs: 700,
    });
    expect(collector.getProgress(500).silenceMs).toBe(0);
    collector.reset();
    expect(collector.getProgress(3_000)).toEqual({});
  });

  it('keeps diagnostic fields bounded and rejects unsafe stage names', () => {
    for (const name of ['https://example.com/token', '/private/path', 'stage=secret', 'a'.repeat(161)]) {
      expect(parseGatewayStartupTraceStage(`startup trace: ${name} 15ms total=25ms`)).toBeNull();
      expect(parseGatewayStartupPhaseStart(`startup phase: ${name} starting total=25ms`)).toBeNull();
    }
    const collector = new GatewayStartupTraceCollector();
    collector.record('startup phase: plugins.bootstrap starting total=1ms token=do-not-copy', 100);
    collector.record('startup trace: plugins.bootstrap 2ms total=3ms token=do-not-copy', 200);
    expect(JSON.stringify({ ...collector.getSummary(), ...collector.getProgress(300) })).not.toContain('do-not-copy');
  });

  it('downgrades ANSI-colored readiness probe disconnects', () => {
    const line = '\u001B[36m[ws]\u001B[39m \u001B[33mclosed before connect conn=probe '
      + 'code=1006 reason=n/a phase=ws_upgrade_started ua=n/a\u001B[39m';

    expect(classifyGatewayStderrMessage(line).level).toBe('debug');
  });

  it('downgrades split legacy deprecation continuations instead of reporting false failures', () => {
    expect(classifyGatewayStderrMessage(
      'Rename them by replacing the legacy prefix with OPENCLAW_; the old names are ignored.',
    ).level).toBe('debug');
    expect(classifyGatewayStderrMessage(
      '(Use `ClawX --trace-deprecation ...` to show where the warning was created)',
    ).level).toBe('debug');
  });

  it('keeps non-trace Gateway failures at warning level', () => {
    expect(classifyGatewayStderrMessage('gateway failed to bind port 18789').level).toBe('warn');
  });
});
