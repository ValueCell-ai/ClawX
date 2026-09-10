import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VoiceRecorderError,
  type VoiceRecordingSession,
  startVoiceRecording,
} from '@/lib/voice/recorder';

interface FakeProcessorNode {
  onaudioprocess:
    | ((event: { inputBuffer: { getChannelData: (channel: number) => Float32Array } }) => void)
    | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  inputBuffer: { getChannelData: (channel: number) => Float32Array };
  context: unknown;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  sampleRate = 48000;
  state = 'running';
  destination = {};
  processors: FakeProcessorNode[] = [];
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createGain = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }));
  createScriptProcessor = vi.fn((): FakeProcessorNode => {
    const node: FakeProcessorNode = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      inputBuffer: { getChannelData: () => new Float32Array(4096) },
      context: this,
    };
    this.processors.push(node);
    return node;
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

function makeStream() {
  const stop = vi.fn();
  return {
    stop,
    stream: { getTracks: () => [{ stop }] },
  };
}

function installMediaDevices(getUserMedia: unknown) {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
}

function emitAudio(
  context: FakeAudioContext,
  sampleCount: number,
  fill?: (index: number) => number,
) {
  const processor = context.processors[0];
  processor.onaudioprocess?.({
    inputBuffer: {
      getChannelData: () => {
        const data = new Float32Array(sampleCount);
        if (fill) {
          for (let i = 0; i < sampleCount; i++) {
            data[i] = fill(i);
          }
        }
        return data;
      },
    },
  });
}

async function startWithStubs(): Promise<VoiceRecordingSession> {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return startVoiceRecording();
}

describe('voice recorder', () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'mediaDevices');
    vi.unstubAllGlobals();
    FakeAudioContext.instances = [];
  });

  it('builds a RIFF wav from accumulated callbacks above the minimum length', async () => {
    const stream = makeStream();
    const getUserMedia = vi.fn(async () => stream.stream);
    installMediaDevices(getUserMedia);

    const session = await startWithStubs();
    const context = FakeAudioContext.instances[0];

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(context.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);

    const source = context.createMediaStreamSource.mock.results[0].value;
    const gain = context.createGain.mock.results[0].value;
    const processor = context.processors[0];
    expect(gain.gain.value).toBe(0);
    expect(source.connect).toHaveBeenCalledWith(processor);
    expect(processor.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);

    for (let i = 0; i < 40; i++) {
      emitAudio(context, 4096);
    }
    expect(session.getSampleCount()).toBe(54600);

    const wav = await session.stop();
    const text = (offset: number, length: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + length));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(wav.length).toBe(44 + 54600 * 2);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(stream.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(processor.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports RMS-derived levels through onLevel per processed chunk', async () => {
    installMediaDevices(vi.fn(async () => makeStream().stream));
    const onLevel = vi.fn();

    vi.stubGlobal('AudioContext', FakeAudioContext);
    const session = await startVoiceRecording({ onLevel });
    const context = FakeAudioContext.instances[0];

    emitAudio(context, 4096, (i) => (i % 2 === 0 ? 0.5 : -0.5));
    emitAudio(context, 4096);

    expect(onLevel).toHaveBeenCalledTimes(2);
    expect(onLevel).toHaveBeenNthCalledWith(1, expect.closeTo(1, 6));
    expect(onLevel).toHaveBeenNthCalledWith(2, expect.closeTo(0, 6));

    session.cancel();
  });

  it('rejects TOO_SHORT for a single short callback and stays safe on double stop', async () => {
    installMediaDevices(vi.fn(async () => makeStream().stream));

    const session = await startWithStubs();
    const context = FakeAudioContext.instances[0];
    emitAudio(context, 4096);

    const first = await session.stop().then(
      () => null,
      (error: unknown) => error,
    );
    expect(first).toBeInstanceOf(VoiceRecorderError);
    expect(first).toMatchObject({ code: 'TOO_SHORT' });

    const second = await session.stop().then(
      () => null,
      (error: unknown) => error,
    );
    expect(second).toMatchObject({ code: 'TOO_SHORT' });
  });

  it('rejects MIC_UNAVAILABLE when getUserMedia is missing', async () => {
    installMediaDevices(undefined);

    await expect(startWithStubs()).rejects.toMatchObject({ code: 'MIC_UNAVAILABLE' });
  });

  it('rejects MIC_UNAVAILABLE when getUserMedia throws', async () => {
    installMediaDevices(vi.fn(async () => {
      throw new Error('permission denied');
    }));

    await expect(startWithStubs()).rejects.toMatchObject({ code: 'MIC_UNAVAILABLE' });
  });

  it('cancel discards the buffer so a later stop rejects TOO_SHORT', async () => {
    const stream = makeStream();
    installMediaDevices(vi.fn(async () => stream.stream));

    const session = await startWithStubs();
    const context = FakeAudioContext.instances[0];
    for (let i = 0; i < 10; i++) {
      emitAudio(context, 4096);
    }
    expect(session.getSampleCount()).toBe(13650);

    expect(() => session.cancel()).not.toThrow();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(stream.stop).toHaveBeenCalledTimes(1);
    expect(context.createMediaStreamSource.mock.results[0].value.disconnect).toHaveBeenCalledTimes(1);
    expect(context.createGain.mock.results[0].value.disconnect).toHaveBeenCalledTimes(1);

    await expect(session.stop()).rejects.toMatchObject({ code: 'TOO_SHORT' });
  });

  it('resolves the same wav bytes when stop succeeds twice', async () => {
    installMediaDevices(vi.fn(async () => makeStream().stream));

    const session = await startWithStubs();
    const context = FakeAudioContext.instances[0];
    for (let i = 0; i < 40; i++) {
      emitAudio(context, 4096);
    }

    const first = await session.stop();
    const second = await session.stop();
    expect(second).toBe(first);
  });

  it('resolves the same wav bytes when stop is invoked twice synchronously', async () => {
    installMediaDevices(vi.fn(async () => makeStream().stream));

    const session = await startWithStubs();
    const context = FakeAudioContext.instances[0];
    for (let i = 0; i < 40; i++) {
      emitAudio(context, 4096);
    }
    expect(session.getSampleCount()).toBe(54600);

    const first = session.stop();
    const second = session.stop();
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
  });
});
