export type MicrophoneBridge = {
  stop: () => void;
};

const processorSource = `
const CHUNK_SIZE = 4096;

class ClawXTalkMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(CHUNK_SIZE);
    this.offset = 0;
  }

  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!samples) return true;
    let sourceOffset = 0;
    while (sourceOffset < samples.length) {
      const copyLength = Math.min(CHUNK_SIZE - this.offset, samples.length - sourceOffset);
      this.chunk.set(samples.subarray(sourceOffset, sourceOffset + copyLength), this.offset);
      this.offset += copyLength;
      sourceOffset += copyLength;
      if (this.offset === CHUNK_SIZE) {
        const chunk = this.chunk;
        this.port.postMessage(chunk, [chunk.buffer]);
        this.chunk = new Float32Array(CHUNK_SIZE);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('clawx-talk-mic', ClawXTalkMicProcessor);
`;

export async function createMicrophoneBridge(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void,
): Promise<MicrophoneBridge> {
  if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet) {
    throw new Error('Realtime microphone audio is not supported');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const url = URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'clawx-talk-mic');
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
    source.connect(worklet);
    worklet.connect(silentOutput);
    silentOutput.connect(context.destination);
    return {
      stop: () => {
        source.disconnect();
        worklet.disconnect();
        silentOutput.disconnect();
        for (const track of stream.getTracks()) track.stop();
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
