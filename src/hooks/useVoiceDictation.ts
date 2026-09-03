import { useCallback, useEffect, useRef, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { parseAsrErrorCode, type AsrErrorCode } from '@shared/asr/errors';
import {
  startVoiceRecording,
  type VoiceRecorderErrorCode,
  type VoiceRecordingSession,
} from '@/lib/voice/recorder';

export type VoiceDictationStatus = 'idle' | 'recording' | 'transcribing';

export type { AsrErrorCode };

export interface UseVoiceDictationOptions {
  disabled: boolean;
  onUnconfigured: () => void;
  onError: (code: AsrErrorCode | VoiceRecorderErrorCode) => void;
  onTranscribed: (text: string) => void;
  onLevel?: (level: number) => void;
}

export interface UseVoiceDictationResult {
  status: VoiceDictationStatus;
  elapsedSeconds: number;
  toggle: () => Promise<void>;
  cancel: () => void;
  getLevels: () => number[];
}

export const VOICE_MAX_RECORDING_MS = 180_000;
export const VOICE_TIMER_INTERVAL_MS = 250;
export const VOICE_LEVEL_HISTORY = 24;

const ASR_ERROR_CODES: ReadonlySet<string> = new Set<AsrErrorCode | VoiceRecorderErrorCode>([
  'INVALID_INPUT',
  'NOT_CONFIGURED',
  'AUTH',
  'RATE_LIMITED',
  'SERVER',
  'REQUEST',
  'NETWORK',
  'EMPTY_RESULT',
  'MIC_UNAVAILABLE',
  'TOO_SHORT',
]);

function resolveAsrErrorCode(error: unknown): AsrErrorCode {
  const message = error instanceof Error ? error.message : '';
  const parsed = message ? parseAsrErrorCode(message) : null;
  if (parsed) return parsed;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ASR_ERROR_CODES.has(code)) {
    return code as AsrErrorCode;
  }
  return 'REQUEST';
}

export function useVoiceDictation(options: UseVoiceDictationOptions): UseVoiceDictationResult {
  const { disabled, onUnconfigured, onError, onTranscribed, onLevel } = options;
  const [status, setStatus] = useState<VoiceDictationStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const statusRef = useRef<VoiceDictationStatus>('idle');
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const sessionRef = useRef<VoiceRecordingSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const disabledRef = useRef(disabled);
  const callbacksRef = useRef({ onUnconfigured, onError, onTranscribed, onLevel });
  const levelsRef = useRef<number[]>(new Array<number>(VOICE_LEVEL_HISTORY).fill(0));

  useEffect(() => {
    disabledRef.current = disabled;
    callbacksRef.current = { onUnconfigured, onError, onTranscribed, onLevel };
  });

  const applyStatus = useCallback((next: VoiceDictationStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearLevels = useCallback(() => {
    levelsRef.current = new Array<number>(VOICE_LEVEL_HISTORY).fill(0);
  }, []);

  const getLevels = useCallback(() => levelsRef.current, []);

  const handleLevel = useCallback((level: number) => {
    const buffer = levelsRef.current;
    buffer.push(level);
    if (buffer.length > VOICE_LEVEL_HISTORY) {
      buffer.shift();
    }
    callbacksRef.current.onLevel?.(level);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetToIdle = useCallback(() => {
    clearTimer();
    setElapsedSeconds(0);
    applyStatus('idle');
  }, [applyStatus, clearTimer]);

  const stopAndTranscribe = useCallback(async (generation: number) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    clearTimer();
    clearLevels();
    applyStatus('transcribing');
    try {
      const wav = await session.stop();
      const { text } = await hostApi.asr.transcribe(wav);
      if (generationRef.current !== generation) return;
      callbacksRef.current.onTranscribed(text);
      resetToIdle();
    } catch (error) {
      if (generationRef.current !== generation) return;
      callbacksRef.current.onError(resolveAsrErrorCode(error));
      resetToIdle();
    }
  }, [applyStatus, clearLevels, clearTimer, resetToIdle]);

  const startTimer = useCallback((generation: number) => {
    clearTimer();
    timerRef.current = setInterval(() => {
      if (generationRef.current !== generation) return;
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedSeconds(Math.floor(elapsed / 1000));
      if (elapsed >= VOICE_MAX_RECORDING_MS) {
        void stopAndTranscribe(generation);
      }
    }, VOICE_TIMER_INTERVAL_MS);
  }, [clearTimer, stopAndTranscribe]);

  const toggle = useCallback(async () => {
    if (disabledRef.current || startingRef.current) return;
    if (statusRef.current === 'idle') {
      startingRef.current = true;
      const generation = ++generationRef.current;
      setElapsedSeconds(0);
      applyStatus('transcribing');
      try {
        const readiness = await hostApi.asr.getConfig();
        if (generationRef.current !== generation) return;
        if (!readiness.configured) {
          startingRef.current = false;
          resetToIdle();
          callbacksRef.current.onUnconfigured();
          return;
        }
        const session = await startVoiceRecording({ onLevel: handleLevel });
        if (generationRef.current !== generation) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
        startingRef.current = false;
        startedAtRef.current = Date.now();
        setElapsedSeconds(0);
        clearLevels();
        applyStatus('recording');
        startTimer(generation);
      } catch (error) {
        if (generationRef.current !== generation) return;
        startingRef.current = false;
        resetToIdle();
        callbacksRef.current.onError(resolveAsrErrorCode(error));
      }
      return;
    }
    if (statusRef.current === 'recording') {
      await stopAndTranscribe(generationRef.current);
    }
  }, [applyStatus, clearLevels, handleLevel, resetToIdle, startTimer, stopAndTranscribe]);

  const cancel = useCallback(() => {
    if (statusRef.current === 'idle') return;
    generationRef.current += 1;
    startingRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.cancel();
    }
    clearLevels();
    resetToIdle();
  }, [clearLevels, resetToIdle]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      startingRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        session.cancel();
      }
      clearTimer();
    };
  }, [clearTimer]);

  return { status, elapsedSeconds, toggle, cancel, getLevels };
}
