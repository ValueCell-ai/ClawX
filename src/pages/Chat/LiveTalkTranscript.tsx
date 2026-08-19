import { MessageCircleReply, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { LiveTalkTranscript as LiveTalkTranscriptEntry } from '@/stores/realtime-talk';

type LiveTalkTranscriptProps = {
  transcripts: LiveTalkTranscriptEntry[];
};

export function LiveTalkTranscript({ transcripts }: LiveTalkTranscriptProps) {
  const { t } = useTranslation('chat');

  if (transcripts.length === 0) return null;

  return (
    <section data-testid="live-talk-transcript" aria-label={t('talk.transcript.label')} className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="space-y-3">
        {transcripts.map((entry, index) => {
          const isUser = entry.role === 'user';
          const voiceLabel = t(isUser ? 'talk.transcript.voiceInput' : 'talk.transcript.voiceResponse');
          const VoiceIcon = isUser ? Mic : MessageCircleReply;
          return (
            <div
              key={`${entry.role}-${index}`}
              data-testid={isUser ? 'live-talk-user-message' : 'live-talk-assistant-message'}
              className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                  isUser ? 'bg-brand text-white' : 'bg-surface-modal text-foreground',
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 text-tiny opacity-70">
                  <VoiceIcon aria-label={voiceLabel} className="h-3 w-3" />
                  <span>{voiceLabel}</span>
                </div>
                <p className="whitespace-pre-wrap break-words">{entry.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
