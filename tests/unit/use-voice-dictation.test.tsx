import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceDictation, VOICE_MAX_RECORDING_MS, VOICE_TIMER_INTERVAL_MS } from '@/hooks/useVoiceDictation';

const hostApiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  transcribe: vi.fn(),
}));

const startVoiceRecordingMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    asr: {
      getConfig: hostApiMocks.getConfig,
      transcribe: hostApiMocks.transcribe,
    },
  },
}));

vi.mock('@/lib/voice/recorder', () => ({
  startVoiceRecording: startVoiceRecordingMock,
}));

const WAV_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function makeSession() {
  return {
    stop: vi.fn(async () => WAV_BYTES),
    cancel: vi.fn(),
    getSampleCount: vi.fn(() => 4800),
  };
}

function setup(overrides?: Partial<Parameters<typeof useVoiceDictation>[0]>) {
  const onUnconfigured = vi.fn();
  const onError = vi.fn();
  const onTranscribed = vi.fn();
  const session = makeSession();
  startVoiceRecordingMock.mockResolvedValue(session);
  hostApiMocks.getConfig.mockResolvedValue({ configured: true, config: null, hasApiKey: true });
  hostApiMocks.transcribe.mockResolvedValue({ text: 'hi' });
  const rendered = renderHook((props: Partial<Parameters<typeof useVoiceDictation>[0]> = {}) =>
    useVoiceDictation({
      disabled: false,
      onUnconfigured,
      onError,
      onTranscribed,
      ...overrides,
      ...props,
    }));
  return { ...rendered, onUnconfigured, onError, onTranscribed, session };
}

describe('useVoiceDictation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the documented recording limits', () => {
    expect(VOICE_MAX_RECORDING_MS).toBe(180_000);
    expect(VOICE_TIMER_INTERVAL_MS).toBe(250);
  });

  it('starts idle and reaches recording with elapsed seconds ticking', async () => {
    const { result } = setup();
    expect(result.current.status).toBe('idle');
    expect(result.current.elapsedSeconds).toBe(0);

    await act(async () => {
      await result.current.toggle();
    });

    expect(hostApiMocks.getConfig).toHaveBeenCalledTimes(1);
    expect(startVoiceRecordingMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('recording');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsedSeconds).toBe(1);

    act(() => {
      vi.advanceTimersByTime(VOICE_TIMER_INTERVAL_MS);
    });
    expect(result.current.elapsedSeconds).toBe(1);

    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(result.current.elapsedSeconds).toBe(2);
  });

  it('toggle while recording stops, transcribes and returns to idle', async () => {
    const { result, onTranscribed, session } = setup();

    await act(async () => {
      await result.current.toggle();
    });

    await act(async () => {
      await result.current.toggle();
    });

    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(hostApiMocks.transcribe).toHaveBeenCalledWith(WAV_BYTES);
    expect(onTranscribed).toHaveBeenCalledWith('hi');
    expect(result.current.status).toBe('idle');
    expect(result.current.elapsedSeconds).toBe(0);
  });

  it('reports unconfigured host and returns to idle', async () => {
    const { result, onUnconfigured } = setup();
    hostApiMocks.getConfig.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    await act(async () => {
      await result.current.toggle();
    });

    expect(startVoiceRecordingMock).not.toHaveBeenCalled();
    expect(onUnconfigured).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });

  it('maps a serialized ASR AUTH rejection to onError and returns to idle', async () => {
    const { result, onError, session } = setup();
    hostApiMocks.transcribe.mockRejectedValue(new Error('ASR:AUTH:bad key'));

    await act(async () => {
      await result.current.toggle();
    });
    await act(async () => {
      await result.current.toggle();
    });

    expect(onError).toHaveBeenCalledWith('AUTH');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.elapsedSeconds).toBe(0);
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('maps a serialized ASR NETWORK rejection to onError', async () => {
    const { result, onError } = setup();
    hostApiMocks.transcribe.mockRejectedValue(new Error('ASR:NETWORK:boom'));

    await act(async () => {
      await result.current.toggle();
    });
    await act(async () => {
      await result.current.toggle();
    });

    expect(onError).toHaveBeenCalledWith('NETWORK');
    expect(result.current.status).toBe('idle');
  });

  it('falls back to REQUEST for host rejections without a usable code', async () => {
    const { result, onError } = setup();
    hostApiMocks.getConfig.mockRejectedValue(new Error('something else'));

    await act(async () => {
      await result.current.toggle();
    });

    expect(onError).toHaveBeenCalledWith('REQUEST');
    expect(result.current.status).toBe('idle');
  });

  it('reports recorder failures through onError', async () => {
    const { result, onError } = setup();
    startVoiceRecordingMock.mockRejectedValue(Object.assign(new Error('MIC_UNAVAILABLE'), { code: 'MIC_UNAVAILABLE' }));

    await act(async () => {
      await result.current.toggle();
    });

    expect(onError).toHaveBeenCalledWith('MIC_UNAVAILABLE');
    expect(result.current.status).toBe('idle');
  });

  it('ignores a rapid double toggle and starts the recorder only once', async () => {
    const { result } = setup();

    await act(async () => {
      const first = result.current.toggle();
      const second = result.current.toggle();
      await Promise.all([first, second]);
    });

    expect(startVoiceRecordingMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('recording');
  });

  it('cancel during recording calls session.cancel and returns to idle', async () => {
    const { result, session } = setup();

    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      result.current.cancel();
    });

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.elapsedSeconds).toBe(0);

    act(() => {
      result.current.cancel();
    });
    expect(session.cancel).toHaveBeenCalledTimes(1);
  });

  it('cancel is a no-op while idle', () => {
    const { result, session } = setup();
    act(() => {
      result.current.cancel();
    });
    expect(session.cancel).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('forwards recorder level events into the ring buffer exposed by getLevels', async () => {
    const { result, session } = setup();

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.getLevels()).toEqual(new Array(24).fill(0));

    const onLevel = startVoiceRecordingMock.mock.calls[0][0].onLevel as (level: number) => void;
    expect(onLevel).toBeTypeOf('function');

    act(() => {
      onLevel(0.5);
      onLevel(1);
    });

    const levels = result.current.getLevels();
    expect(levels).toEqual([...new Array(22).fill(0), 0.5, 1]);

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.getLevels()).toEqual(new Array(24).fill(0));
    expect(session.stop).toHaveBeenCalledTimes(1);
  });

  it('clears the level buffer back to zeros when recording is cancelled', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.toggle();
    });

    const onLevel = startVoiceRecordingMock.mock.calls[0][0].onLevel as (level: number) => void;
    act(() => {
      onLevel(0.75);
    });
    expect(result.current.getLevels().at(-1)).toBe(0.75);

    act(() => {
      result.current.cancel();
    });
    expect(result.current.getLevels()).toEqual(new Array(24).fill(0));
  });

  it('does not deliver transcription after unmount mid-transcribing', async () => {
    const { result, unmount, onTranscribed, onError } = setup();
    let resolveTranscribe!: (value: { text: string }) => void;
    hostApiMocks.transcribe.mockReturnValue(new Promise((resolve) => {
      resolveTranscribe = resolve;
    }));

    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      void result.current.toggle();
    });
    expect(result.current.status).toBe('transcribing');

    const lastStatus = result.current.status;
    act(() => {
      unmount();
      resolveTranscribe({ text: 'late' });
    });
    await act(async () => {});

    expect(lastStatus).toBe('transcribing');
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels the recorder session when unmount happens while the start is pending', async () => {
    const { result, unmount, onError } = setup();
    let resolveStart!: (session: ReturnType<typeof makeSession>) => void;
    const pendingSession = makeSession();
    startVoiceRecordingMock.mockReturnValue(
      new Promise<ReturnType<typeof makeSession>>((resolve) => {
        resolveStart = resolve;
      }),
    );

    await act(async () => {
      void result.current.toggle();
    });
    expect(result.current.status).toBe('transcribing');

    act(() => {
      unmount();
      resolveStart(pendingSession);
    });
    await act(async () => {});

    expect(pendingSession.cancel).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('auto-stops and transcribes after 180 seconds', async () => {
    const { result, onTranscribed, session } = setup();

    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.status).toBe('recording');

    act(() => {
      vi.advanceTimersByTime(VOICE_MAX_RECORDING_MS);
    });
    expect(result.current.status).toBe('transcribing');
    expect(session.stop).toHaveBeenCalledTimes(1);

    await act(async () => {});
    expect(onTranscribed).toHaveBeenCalledWith('hi');
    expect(result.current.status).toBe('idle');
  });

  it('does not record when disabled', async () => {
    const { result } = setup({ disabled: true });

    await act(async () => {
      await result.current.toggle();
    });

    expect(hostApiMocks.getConfig).not.toHaveBeenCalled();
    expect(startVoiceRecordingMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('cancel during transcribing abandons the pending result', async () => {
    const { result, onTranscribed, onError } = setup();
    let resolveTranscribe!: (value: { text: string }) => void;
    hostApiMocks.transcribe.mockReturnValue(new Promise((resolve) => {
      resolveTranscribe = resolve;
    }));

    await act(async () => {
      await result.current.toggle();
    });
    act(() => {
      void result.current.toggle();
    });
    act(() => {
      result.current.cancel();
      resolveTranscribe({ text: 'abandoned' });
    });
    await act(async () => {});

    expect(result.current.status).toBe('idle');
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
