import {
  VOICE_MIN_SAMPLE_COUNT,
  VOICE_TARGET_SAMPLE_RATE,
  buildWavFile,
  encodePcm16Bytes,
  mergeFloat32Chunks,
  resampleLinear,
} from './wav';

export type VoiceRecorderErrorCode = 'MIC_UNAVAILABLE' | 'TOO_SHORT';

export class VoiceRecorderError extends Error {
  constructor(readonly code: VoiceRecorderErrorCode) {
    super(code);
    this.name = 'VoiceRecorderError';
  }
}

interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

interface AudioProcessingEventLike {
  inputBuffer: AudioBufferLike;
}

interface ScriptProcessorNodeLike {
  onaudioprocess: ((event: AudioProcessingEventLike) => void) | null;
  connect(destination: unknown): void;
  disconnect(): void;
}

interface SourceNodeLike {
  connect(destination: unknown): void;
  disconnect(): void;
}

interface GainNodeLike {
  connect(destination: unknown): void;
  disconnect(): void;
  gain: { value: number };
}

interface AudioContextLike {
  sampleRate: number;
  state: string;
  resume(): Promise<void>;
  createScriptProcessor(
    bufferSize: number,
    numberOfInputChannels: number,
    numberOfOutputChannels: number,
  ): ScriptProcessorNodeLike;
  createMediaStreamSource(stream: MediaStream): SourceNodeLike;
  createGain(): GainNodeLike;
  destination: unknown;
  close(): Promise<void>;
}

type AudioContextConstructor = new () => AudioContextLike;

function resolveAudioContextConstructor(): AudioContextConstructor | undefined {
  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export interface VoiceRecordingSession {
  stop: () => Promise<Uint8Array>;
  cancel: () => void;
  getSampleCount: () => number;
}

export interface VoiceRecordingOptions {
  onLevel?: (level: number) => void;
}

const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

export async function startVoiceRecording(
  options?: VoiceRecordingOptions,
): Promise<VoiceRecordingSession> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new VoiceRecorderError('MIC_UNAVAILABLE');
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    throw new VoiceRecorderError('MIC_UNAVAILABLE');
  }

  const ContextConstructor = resolveAudioContextConstructor();
  if (!ContextConstructor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new VoiceRecorderError('MIC_UNAVAILABLE');
  }

  let context: AudioContextLike;
  try {
    context = new ContextConstructor();
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new VoiceRecorderError('MIC_UNAVAILABLE');
  }

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      try {
        await context.close();
      } catch {
        // close() can reject if the context was already closed.
      }
      throw new VoiceRecorderError('MIC_UNAVAILABLE');
    }
  }

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
  const gain = context.createGain();
  gain.gain.value = 0;

  const outputChunks: Float32Array[] = [];
  let sampleCount = 0;
  let stopped = false;
  let stopPromise: Promise<Uint8Array> | undefined;
  let stopError: VoiceRecorderError | undefined;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0).slice();
    const output = resampleLinear(input, context.sampleRate, VOICE_TARGET_SAMPLE_RATE);
    outputChunks.push(output);
    sampleCount += output.length;
    if (input.length > 0) {
      let sumSquares = 0;
      for (let i = 0; i < input.length; i++) {
        sumSquares += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSquares / input.length);
      const level = Math.min(1, rms * 4);
      options?.onLevel?.(level);
    }
  };

  source.connect(processor);
  processor.connect(gain);
  gain.connect(context.destination);

  const teardown = async () => {
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      gain.disconnect();
    } catch {
      // Nodes may already be detached while the context is closing.
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Track stopping is best-effort during teardown.
      }
    }
    try {
      await context.close();
    } catch {
      // close() can reject if the context was already closed.
    }
  };

  const doStop = async (): Promise<Uint8Array> => {
    await teardown();
    if (sampleCount < VOICE_MIN_SAMPLE_COUNT) {
      throw new VoiceRecorderError('TOO_SHORT');
    }
    return buildWavFile(encodePcm16Bytes(mergeFloat32Chunks(outputChunks)), VOICE_TARGET_SAMPLE_RATE);
  };

  const stop = (): Promise<Uint8Array> => {
    if (stopPromise) return stopPromise;
    if (stopped) {
      return Promise.reject(stopError ?? new VoiceRecorderError('TOO_SHORT'));
    }
    stopped = true;
    stopPromise = doStop();
    return stopPromise;
  };

  const cancel = (): void => {
    if (stopped) return;
    stopped = true;
    stopError = new VoiceRecorderError('TOO_SHORT');
    void teardown();
  };

  return {
    stop,
    cancel,
    getSampleCount: () => sampleCount,
  };
}
