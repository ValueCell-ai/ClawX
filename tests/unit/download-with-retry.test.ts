import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { downloadBufferWithRetry } from '../../scripts/download-with-retry.mjs';

const FULL = Buffer.from('0123456789');
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function droppedResponse(prefix: Buffer): Response {
  let sent = false;
  const body = new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.error(new TypeError('terminated', { cause: new Error('other side closed') }));
        return;
      }
      sent = true;
      controller.enqueue(new Uint8Array(prefix));
    },
  });
  return new Response(body, { status: 200 });
}

function partialResponse(start: number): Response {
  return new Response(new Uint8Array(FULL.subarray(start)), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${FULL.length - 1}/${FULL.length}` },
  });
}

const quiet = { baseDelayMs: 0, log: () => {} };

describe('downloadBufferWithRetry', () => {
  it('resumes a dropped download with a Range request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(droppedResponse(FULL.subarray(0, 4)))
      .mockResolvedValueOnce(partialResponse(4));

    const buffer = await downloadBufferWithRetry('https://a.test/f.zip', { ...quiet, fetchImpl, sha256: sha256(FULL) });

    expect(buffer.equals(FULL)).toBe(true);
    expect(fetchImpl.mock.calls[0][1]).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1]).toEqual({ headers: { Range: 'bytes=4-' } });
  });

  it('starts over when the server ignores the Range header', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(droppedResponse(FULL.subarray(0, 4)))
      .mockResolvedValueOnce(new Response(new Uint8Array(FULL), { status: 200 }));

    const buffer = await downloadBufferWithRetry('https://a.test/f.zip', { ...quiet, fetchImpl });

    expect(buffer.equals(FULL)).toBe(true);
  });

  it('falls back to the next source when the checksum does not match', async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(
      url.startsWith('https://primary') ? 'tampered' : new Uint8Array(FULL),
    ));

    const buffer = await downloadBufferWithRetry(
      ['https://primary.test/f.zip', 'https://mirror.test/f.zip'],
      { ...quiet, fetchImpl, sha256: sha256(FULL) },
    );

    expect(buffer.equals(FULL)).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://primary.test/f.zip',
      'https://mirror.test/f.zip',
    ]);
  });

  it('does not retry a 404 and reports the last source failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('missing', { status: 404, statusText: 'Not Found' }));

    await expect(downloadBufferWithRetry('https://a.test/f.zip', { ...quiet, fetchImpl, label: 'f.zip' }))
      .rejects.toThrow('Failed to download f.zip: 404 Not Found');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries server errors up to the attempt limit', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(FULL)));

    const buffer = await downloadBufferWithRetry('https://a.test/f.zip', { ...quiet, fetchImpl });

    expect(buffer.equals(FULL)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
