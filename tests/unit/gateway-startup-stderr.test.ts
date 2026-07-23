import { describe, expect, it } from 'vitest';
import {
  classifyGatewayStderrMessage,
  GatewayStartupTraceCollector,
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
