import { describe, expect, it, vi } from 'vitest';
import {
  decodePcm16Base64,
  float32ToPcm16,
  MAX_TALK_PLAYBACK_CHUNKS,
  MAX_TALK_PLAYBACK_DECODED_BYTES,
  MAX_TALK_PLAYBACK_DURATION_SECONDS,
  Pcm16PlaybackQueue,
  pcm16ToBase64,
  pcm16ToFloat32,
  StreamingResampler,
} from '@/lib/talk/audio';

describe('Talk audio codec', () => {
  it('converts Float32 microphone samples to clipped little-endian PCM16', () => {
    expect([...float32ToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1, 2]))])
      .toEqual([-32768, -16384, 0, 16383, 32767, 32767]);
  });

  it('round-trips PCM16 bytes through base64', () => {
    const pcm = new Int16Array([-32768, 0, 32767]);

    expect(pcm16ToBase64(pcm)).toBe('AIAAAP9/');
  });

  it('rejects malformed and odd-length PCM16 base64 payloads', () => {
    expect(() => decodePcm16Base64('not base64')).toThrow('Invalid PCM16 base64 audio');
    expect(() => decodePcm16Base64('AQ==')).toThrow('Invalid PCM16 byte length');
  });

  it('rejects oversized valid base64 before invoking atob or allocating PCM', () => {
    const atob = vi.fn();
    vi.stubGlobal('atob', atob);
    const oversized = 'AAAA'.repeat(Math.ceil((MAX_TALK_PLAYBACK_DECODED_BYTES + 1) / 3));

    try {
      expect(() => decodePcm16Base64(oversized)).toThrow('Talk PCM chunk exceeds decoded size limit');
      expect(atob).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('decodes little-endian PCM16 output for playback', () => {
    const decoded = pcm16ToFloat32(decodePcm16Base64('AIAAAP9/'));

    expect([...decoded]).toEqual([-1, 0, 32767 / 32768]);
  });

  it('preserves resampling phase across microphone frames at the negotiated rate', () => {
    const resampler = new StreamingResampler(48_000, 24_000);
    const output = Array.from({ length: 100 }, (_, chunk) => (
      resampler.process(new Float32Array(480).fill(chunk / 100))
    )).flatMap((samples) => [...samples]);

    expect(output).toHaveLength(24_000);
    expect(output[0]).toBe(0);
    expect(output.at(-1)).toBeCloseTo(0.99, 4);
  });

  it('matches continuous 48kHz-to-16kHz conversion across arbitrary 128-sample frames', () => {
    const source = Float32Array.from({ length: 12_800 }, (_, index) => Math.sin(index / 19));
    const continuous = new StreamingResampler(48_000, 16_000).process(source);
    const chunkedResampler = new StreamingResampler(48_000, 16_000);
    const chunked = Array.from({ length: 100 }, (_, index) => (
      chunkedResampler.process(source.slice(index * 128, (index + 1) * 128))
    )).flatMap((samples) => [...samples]);

    expect(chunked).toEqual([...continuous]);
  });

  it('rejects oversized PCM before allocating playback buffers and releases duration budget on clear', async () => {
    const sources: Array<{ onended: (() => void) | null; stop: ReturnType<typeof vi.fn> }> = [];
    const createBuffer = vi.fn(() => ({ duration: 35, copyToChannel: vi.fn() }));
    const context = {
      currentTime: 0,
      destination: {},
      createBuffer,
      createBufferSource: vi.fn(() => {
        const source = { onended: null as (() => void) | null, stop: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null };
        sources.push(source);
        return source;
      }),
    } as unknown as AudioContext;
    const queue = new Pcm16PlaybackQueue(context);
    const oversized = new Int16Array((Math.max(MAX_TALK_PLAYBACK_DECODED_BYTES ?? 0, 2_000_000) / 2) + 1);
    const thirtyFiveSeconds = new Int16Array(8_000 * 35);

    await expect(queue.enqueue(oversized, 24_000)).rejects.toThrow('Talk PCM chunk exceeds decoded size limit');
    expect(createBuffer).not.toHaveBeenCalled();
    void queue.enqueue(thirtyFiveSeconds, 8_000);
    await expect(queue.enqueue(thirtyFiveSeconds, 8_000)).rejects.toThrow('Talk playback duration queue is full');
    queue.clear();
    void queue.enqueue(thirtyFiveSeconds, 8_000);
    expect(MAX_TALK_PLAYBACK_DURATION_SECONDS).toBeGreaterThanOrEqual(35);
    expect(sources).toHaveLength(2);
  });

  it('accepts a fragmented 44.4-second provider response from 111 short chunks', async () => {
    const sources: Array<{ onended: (() => void) | null; stop: ReturnType<typeof vi.fn> }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      createBuffer: vi.fn(() => ({ duration: 0.4, copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => {
        const source = { onended: null as (() => void) | null, stop: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null };
        sources.push(source);
        return source;
      }),
    } as unknown as AudioContext;
    const queue = new Pcm16PlaybackQueue(context);
    const chunk = new Int16Array(24_000 * 0.4);

    const completions = Array.from({ length: 111 }, () => queue.enqueue(chunk, 24_000));
    for (const source of sources) source.onended?.();
    const results = await Promise.allSettled(completions);

    expect(MAX_TALK_PLAYBACK_CHUNKS).toBeGreaterThanOrEqual(111);
    expect(MAX_TALK_PLAYBACK_DURATION_SECONDS).toBeGreaterThanOrEqual(44.4);
    expect(sources).toHaveLength(111);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('rejects playback that exceeds the finite duration bound', async () => {
    const sources: Array<{ onended: (() => void) | null; stop: ReturnType<typeof vi.fn> }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      createBuffer: vi.fn(() => ({ duration: MAX_TALK_PLAYBACK_DURATION_SECONDS, copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => {
        const source = { onended: null as (() => void) | null, stop: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null };
        sources.push(source);
        return source;
      }),
    } as unknown as AudioContext;
    const queue = new Pcm16PlaybackQueue(context);
    const fullDuration = new Int16Array(8_000 * MAX_TALK_PLAYBACK_DURATION_SECONDS);
    const completion = queue.enqueue(fullDuration, 8_000);

    await expect(queue.enqueue(new Int16Array(1), 8_000)).rejects.toThrow('Talk playback duration queue is full');
    sources[0]?.onended?.();
    await expect(completion).resolves.toBeUndefined();
  });

  it('rejects playback that exceeds the finite item bound', async () => {
    const sources: Array<{ onended: (() => void) | null; stop: ReturnType<typeof vi.fn> }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      createBuffer: vi.fn(() => ({ duration: 1 / 8_000, copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => {
        const source = { onended: null as (() => void) | null, stop: vi.fn(), connect: vi.fn(), start: vi.fn(), buffer: null };
        sources.push(source);
        return source;
      }),
    } as unknown as AudioContext;
    const queue = new Pcm16PlaybackQueue(context);
    const completions = Array.from({ length: MAX_TALK_PLAYBACK_CHUNKS }, () => queue.enqueue(new Int16Array(1), 8_000));

    await expect(queue.enqueue(new Int16Array(1), 8_000)).rejects.toThrow('Talk playback queue is full');
    for (const source of sources) source.onended?.();
    await expect(Promise.all(completions)).resolves.toEqual(Array(MAX_TALK_PLAYBACK_CHUNKS).fill(undefined));
  });
});
