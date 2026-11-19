// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const load = createRequire(import.meta.url);
const dist = path.resolve('node_modules/openclaw/dist');

type Limit = { limitBytes: number; actualBytes?: number; channel?: string; code: string };
const { publicOutboundMediaLimit } = load(path.join(dist, 'store.shared-CVpD4EkK.mjs')) as {
  publicOutboundMediaLimit: (value: unknown, channel?: string) =>
    { message: string; details: Limit } | undefined;
};
const { n: loadWebMedia } = load(path.join(dist, 'web-media-B8mlVr8x.mjs')) as {
  n: (source: string, options: { maxBytes: number; localRoots: string; readFile: () => Promise<Buffer> }) => Promise<unknown>;
};

describe('outbound attachment size errors', () => {
  it('retains exact byte counts from the runtime loader and projects only public fields', async () => {
    const limitBytes = 5 * 1024 * 1024;
    const actualBytes = 10_370_000;
    const source = path.resolve('private-workspace', 'customer-attachment.xlsm');
    const error = await loadWebMedia(source, {
      maxBytes: limitBytes,
      localRoots: 'any',
      readFile: async () => Buffer.alloc(actualBytes),
    }).then(() => undefined, reason => reason);
    const failure = publicOutboundMediaLimit(error, 'wecom');
    expect(failure).toEqual({
      message: 'wecom: Media exceeds 5MB limit (got 9.89MB)',
      details: { code: 'OUTBOUND_MEDIA_TOO_LARGE', channel: 'wecom', limitBytes, actualBytes },
    });
    expect(publicOutboundMediaLimit({
      ...failure!.details, source, cause: new Error(source), to: 'private-recipient',
    })).toEqual(failure);
  });

  it('returns a bounded HTTP 413 for known direct and RPC size failures', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clawx-media-limit-http-'));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [path.resolve('tests/fixtures/outbound-media-limit-http.mjs')], {
        env: { ...process.env, OPENCLAW_STATE_DIR: home, OPENCLAW_HOME: home, OPENCLAW_CONFIG_PATH: path.join(home, 'openclaw.json') },
      });
      const response = JSON.parse(stdout.trim().split('\n').at(-1)!);
      const expected = {
        status: 413, ok: false,
        error: {
          type: 'media_too_large', code: 'OUTBOUND_MEDIA_TOO_LARGE', channel: 'wecom',
          message: 'wecom: Media exceeds 5MB limit (got 9.89MB)', limitBytes: 5242880, actualBytes: 10370000,
        },
      };
      expect(response.rpc).toEqual(expected);
      expect(response.direct).toEqual(expected);
      expect(response.forbidden.status).toBe(403);
      const unknown = { status: 500, ok: false, error: { type: 'tool_error', message: 'tool execution failed' } };
      expect(response.unknown).toEqual(unknown);
      expect(response.queued).toEqual(unknown);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('keeps an unknown actual size absent and rejects invalid sizes and untyped messages', () => {
    const details = { limitBytes: 1024, code: 'OUTBOUND_MEDIA_TOO_LARGE' };
    expect(publicOutboundMediaLimit(details, '/private/channel')).toEqual({
      message: 'Media exceeds 1KB limit', details,
    });
    expect(publicOutboundMediaLimit(new Error('Media exceeds 5MB limit (got 9.89MB)'))).toBeUndefined();
    expect(publicOutboundMediaLimit({ ...details, actualBytes: -1 })).toBeUndefined();
    expect(publicOutboundMediaLimit({ ...details, limitBytes: 'private-data' })).toBeUndefined();
  });
});
