import { describe, expect, it } from 'vitest';
import {
  VOICE_MIN_RECORDING_MS,
  VOICE_MIN_SAMPLE_COUNT,
  VOICE_TARGET_SAMPLE_RATE,
  buildWavFile,
  encodePcm16Bytes,
  mergeFloat32Chunks,
  resampleLinear,
} from '@/lib/voice/wav';

describe('voice wav utilities', () => {
  it('exposes voice constants', () => {
    expect(VOICE_TARGET_SAMPLE_RATE).toBe(16000);
    expect(VOICE_MIN_RECORDING_MS).toBe(300);
    expect(VOICE_MIN_SAMPLE_COUNT).toBe(4800);
  });

  it('merges float32 chunks in order', () => {
    const merged = mergeFloat32Chunks([
      Float32Array.from([1, 2]),
      new Float32Array(0),
      Float32Array.from([3, 4, 5]),
    ]);
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns an empty array when merging no chunks', () => {
    expect(mergeFloat32Chunks([]).length).toBe(0);
  });

  it('resamples 32k to 16k by halving length', () => {
    const input = Float32Array.from({ length: 320 }, (_, i) => i / 320);
    const output = resampleLinear(input, 32000, 16000);
    expect(output.length).toBe(160);
  });

  it('preserves a constant signal when resampling', () => {
    const input = new Float32Array(800).fill(0.5);
    const output = resampleLinear(input, 32000, 16000);
    expect(output.length).toBe(400);
    for (const sample of output) {
      expect(sample).toBeCloseTo(0.5, 6);
    }
  });

  it('encodes pcm16 as little-endian and clamps out-of-range samples', () => {
    const samples = Float32Array.from([-2, -1, 0, 1, 2]);
    const bytes = encodePcm16Bytes(samples);
    expect(bytes.length).toBe(10);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(-32768);
    expect(view.getInt16(4, true)).toBe(0);
    expect(view.getInt16(6, true)).toBe(32767);
    expect(view.getInt16(8, true)).toBe(32767);
  });

  it('round-trips a mid-range pcm16 sample', () => {
    const samples = Float32Array.from([0.5]);
    const view = new DataView(encodePcm16Bytes(samples).buffer);
    expect(view.getInt16(0, true)).toBe(16384);
  });

  it('builds a 44-byte RIFF WAV header around pcm data', () => {
    const pcm = encodePcm16Bytes(Float32Array.from([0, 0.25, -0.25]));
    const wav = buildWavFile(pcm, 16000);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + length));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(wav.length).toBe(44 + pcm.length);
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 2);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(Array.from(wav.subarray(44))).toEqual(Array.from(pcm));
  });
});
