import { useEffect, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VOICE_LEVEL_HISTORY, type VoiceDictationStatus } from '@/hooks/useVoiceDictation';

export interface VoiceDictationButtonProps {
  status: VoiceDictationStatus;
  elapsedSeconds: number;
  disabled: boolean;
  onToggle: () => void;
  onCancel: () => void;
  getLevels?: () => number[];
}

const VOICE_WAVEFORM_BARS = 5;
const VOICE_WAVEFORM_POLL_MS = 120;

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function VoiceDictationButton({
  status,
  elapsedSeconds,
  disabled,
  onToggle,
  onCancel,
  getLevels,
}: VoiceDictationButtonProps) {
  const { t } = useTranslation('chat');
  const recording = status === 'recording';
  const transcribing = status === 'transcribing';
  const [levels, setLevels] = useState<number[]>(() => new Array<number>(VOICE_LEVEL_HISTORY).fill(0));

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      const snapshot = getLevels?.();
      if (snapshot) {
        setLevels([...snapshot]);
      }
    }, VOICE_WAVEFORM_POLL_MS);
    return () => clearInterval(interval);
  }, [recording, getLevels]);

  const barHeights: number[] = [];
  for (let bar = 0; bar < VOICE_WAVEFORM_BARS; bar++) {
    const start = Math.floor((bar * levels.length) / VOICE_WAVEFORM_BARS);
    const end = Math.floor(((bar + 1) * levels.length) / VOICE_WAVEFORM_BARS);
    let bucketMax = 0;
    for (let i = start; i < end && i < levels.length; i++) {
      bucketMax = Math.max(bucketMax, levels[i] ?? 0);
    }
    const clamped = Math.min(1, Math.max(0, bucketMax));
    barHeights.push(4 + 14 * clamped);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="chat-composer-voice"
      className={cn(
        'shrink-0 h-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
        recording ? 'w-auto gap-1 px-2' : 'w-8',
      )}
      onClick={() => {
        if (!recording) {
          setLevels(new Array<number>(VOICE_LEVEL_HISTORY).fill(0));
        }
        onToggle();
      }}
      onKeyDown={(event) => {
        if (recording && event.key === 'Escape') {
          onCancel();
        }
      }}
      disabled={disabled || transcribing}
      title={recording ? t('composer.voiceStop') : t('composer.voiceInput')}
    >
      {transcribing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : recording ? (
        <>
          <Square className="h-3 w-3 fill-current" />
          <span
            data-testid="chat-composer-voice-waveform"
            className="flex h-4 items-center gap-[2px]"
          >
            {barHeights.map((height, index) => (
              <span
                key={index}
                className="w-[3px] rounded-full bg-current"
                style={{ height: `${height}px` }}
              />
            ))}
          </span>
          <span className="text-meta tabular-nums">{formatElapsedTime(elapsedSeconds)}</span>
        </>
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
