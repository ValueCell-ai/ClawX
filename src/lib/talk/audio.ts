export function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = Math.trunc(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
  }
  return pcm;
}

function pcm16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index] ?? 0, true);
  }
  return bytes;
}

export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = pcm16ToBytes(samples);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodePcm16Base64(audioBase64: string): Int16Array {
  if (
    typeof audioBase64 !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)
  ) throw new Error('Invalid PCM16 base64 audio');

  const paddingLength = audioBase64.endsWith('==') ? 2 : audioBase64.endsWith('=') ? 1 : 0;
  const decodedByteLength = (audioBase64.length / 4) * 3 - paddingLength;
  if (decodedByteLength > MAX_TALK_PLAYBACK_DECODED_BYTES) {
    throw new Error('Talk PCM chunk exceeds decoded size limit');
  }

  let binary: string;
  try {
    binary = atob(audioBase64);
  } catch {
    throw new Error('Invalid PCM16 base64 audio');
  }
  if (binary.length === 0 || binary.length % 2 !== 0) throw new Error('Invalid PCM16 byte length');

  const pcm = new Int16Array(binary.length / 2);
  for (let index = 0; index < pcm.length; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    pcm[index] = (high << 8) | low;
  }
  return pcm;
}

export function pcm16ToFloat32(samples: Int16Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) output[index] = (samples[index] ?? 0) / 0x8000;
  return output;
}

export function inputLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length));
}

function assertSupportedSampleRates(sourceSampleRateHz: number, targetSampleRateHz: number): void {
  if (
    !Number.isInteger(sourceSampleRateHz)
    || !Number.isInteger(targetSampleRateHz)
    || sourceSampleRateHz < 8_000
    || sourceSampleRateHz > 192_000
    || targetSampleRateHz < 8_000
    || targetSampleRateHz > 192_000
  ) throw new Error('Unsupported Talk audio sample rate');
}

export class StreamingResampler {
  private buffer = new Float32Array(0);
  private position = 0;
  private readonly step: number;

  constructor(
    private readonly sourceSampleRateHz: number,
    private readonly targetSampleRateHz: number,
  ) {
    assertSupportedSampleRates(sourceSampleRateHz, targetSampleRateHz);
    this.step = sourceSampleRateHz / targetSampleRateHz;
  }

  process(samples: Float32Array): Float32Array {
    if (samples.length === 0) return new Float32Array(0);
    const buffered = new Float32Array(this.buffer.length + samples.length);
    buffered.set(this.buffer);
    buffered.set(samples, this.buffer.length);
    if (this.sourceSampleRateHz === this.targetSampleRateHz) {
      this.buffer = new Float32Array(0);
      return buffered;
    }

    const output: number[] = [];
    while (this.position + 1 < buffered.length) {
      const before = Math.floor(this.position);
      const fraction = this.position - before;
      output.push(
        (buffered[before] ?? 0) * (1 - fraction) + (buffered[before + 1] ?? 0) * fraction,
      );
      this.position += this.step;
    }
    // Keep the phase relative to the next frame even when it advances past this buffer.
    const consumed = Math.min(Math.floor(this.position), buffered.length);
    this.buffer = buffered.slice(consumed);
    this.position -= consumed;
    return new Float32Array(output);
  }
}

// Allow a normal 111-chunk, 44-second relay response with bounded headroom while retaining
// finite per-event bytes, queued items, and queued playback duration.
export const MAX_TALK_PLAYBACK_CHUNKS = 128;
export const MAX_TALK_PLAYBACK_DURATION_SECONDS = 60;
export const MAX_TALK_PLAYBACK_DECODED_BYTES = 2 * 1024 * 1024;

export class Pcm16PlaybackQueue {
  private nextStartAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private queuedDurationSeconds = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly maxQueuedItems = MAX_TALK_PLAYBACK_CHUNKS,
  ) {}

  enqueue(samples: Int16Array, sampleRate: number): Promise<void> {
    if (samples.byteLength > MAX_TALK_PLAYBACK_DECODED_BYTES) {
      return Promise.reject(new Error('Talk PCM chunk exceeds decoded size limit'));
    }
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
      return Promise.reject(new Error('Unsupported Talk playback sample rate'));
    }
    if (this.sources.size >= this.maxQueuedItems) return Promise.reject(new Error('Talk playback queue is full'));
    const duration = samples.length / sampleRate;
    if (this.queuedDurationSeconds + duration > MAX_TALK_PLAYBACK_DURATION_SECONDS) {
      return Promise.reject(new Error('Talk playback duration queue is full'));
    }
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(pcm16ToFloat32(samples)), 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime, this.nextStartAt);
    this.nextStartAt = startAt + buffer.duration;
    this.sources.add(source);
    this.queuedDurationSeconds += duration;
    return new Promise((resolve) => {
      source.onended = () => {
        if (this.sources.delete(source)) {
          this.queuedDurationSeconds = Math.max(0, this.queuedDurationSeconds - duration);
        }
        resolve();
      };
      source.start(startAt);
    });
  }

  clear(): void {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.queuedDurationSeconds = 0;
    this.nextStartAt = this.context.currentTime;
  }
}
