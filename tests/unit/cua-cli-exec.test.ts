// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

// POSIX CLI quoting only. No native CUA, live Gateway, Electron, or real provider is used.
describe.skipIf(process.platform === 'win32')('CUA CLI through pinned OpenClaw exec/read', () => {
  let report: ReturnType<typeof JSON.parse>;

  beforeAll(async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'cua cli ')));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [
        resolve('tests/fixtures/cua-cli/openclaw-integration.mjs'),
      ], {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
        // Do not inherit credentials, the user's config, shell startup files, or proxy settings.
        env: {
          HOME: home, TMPDIR: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
          OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: join(home, '.openclaw'),
          OPENCLAW_CONFIG_PATH: join(home, '.openclaw', 'openclaw.json'),
          SHELL: '/bin/sh', PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        },
      });
      const line = stdout.split('\n').find((entry) => entry.startsWith('CUA_INTEGRATION_RESULT='));
      expect(line, stdout).toBeDefined();
      report = JSON.parse(line!.slice('CUA_INTEGRATION_RESULT='.length));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 70000);

  it('bootstraps the descriptor and preserves endpoint/session across separate shell executions', () => {
    expect(report.version).toBe('2026.7.1-2');
    expect(report.descriptor).toMatchObject({ v: 2, driverVersion: '0.21.0', generation: 'synthetic-generation-1' });
    expect(report.descriptor.binaryPath).toContain("bundled driver's CLI.mjs");
    expect(report.descriptor.socketPath).toContain('host endpoint.sock');
    expect(report.calls.map((call: { tool: string }) => call.tool)).toEqual([
      'list_windows', 'get_window_state', 'verify_state', 'get_window_state', 'end_session',
    ]);
    expect(new Set(report.calls.map((call: { pid: number }) => call.pid)).size).toBe(5);
    for (const call of report.calls) {
      expect(call.endpoint).toBe(report.descriptor.socketPath);
      expect(call.args.session).toBe('clawx-integration-workflow');
    }
    expect(report.remainingSessions).toBe(0);
    expect(report.endpointErrors).toEqual([]);
    for (const key of ['bootstrap', 'discovery', 'capture', 'verification', 'failure', 'cleanup']) {
      expect(report[key].details).toMatchObject({ status: 'completed', exitCode: 0 });
    }
  });

  it('reads a fresh local PNG as an image and serializes it into the real provider request body', () => {
    const images = report.image.content.filter((part: { type: string }) => part.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe('image/png');
    expect(Buffer.from(images[0].data, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(report.requests).toHaveLength(4);
    const serialized = report.requests[1];
    expect(serialized).toMatchObject({ method: 'POST', url: 'https://cua-provider.invalid/v1/chat/completions' });
    expect(serialized.body.model).toBe('gpt-4o');
    const parts = serialized.body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : []);
    expect(parts.filter((part: { type: string }) => part.type === 'image_url')).toEqual([
      expect.objectContaining({ image_url: expect.objectContaining({ url: `data:image/png;base64,${images[0].data}` }) }),
    ]);
    // Negative control: a successful CLI screenshot path on stdout is not model vision.
    expect(JSON.stringify(report.requests[0].body)).not.toContain('data:image/');
    expect(JSON.stringify(report.requests[0].body)).toContain('screenshot_file_path');
    for (const response of report.responses) expect(response.stopReason).toBe('stop');
  });

  it('preserves semantic stdout errors despite exit zero and cannot read a failed capture', () => {
    expect(report.failure.details.exitCode).toBe(0);
    expect(report.failure.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('SCREENSHOT_WRITE_FAILED') }),
    ]));
    expect(report.verification.details.exitCode).toBe(0);
    expect(JSON.stringify(report.requests[3].body)).toContain('unsatisfied');
    expect(JSON.stringify(report.requests[2].body)).toContain('SCREENSHOT_WRITE_FAILED');
    expect(JSON.stringify(report.requests[2].body)).not.toContain('data:image/');
    expect(report.missingImageError).toMatch(/ENOENT|not found|does not exist/i);
  });
});
