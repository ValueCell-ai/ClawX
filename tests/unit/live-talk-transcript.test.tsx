import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveTalkTranscript } from '@/pages/Chat/LiveTalkTranscript';
import { LIVE_TALK_TRANSCRIPT_MOCK } from '@/pages/Chat/live-talk-transcript-mock';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => ({
      'talk.transcript.label': 'Live Talk',
      'talk.transcript.microphone': 'Microphone',
      'talk.transcript.voiceInput': 'Voice input',
      'talk.transcript.voiceResponse': 'Voice response',
    })[key] ?? key,
  }),
}));

describe('LiveTalkTranscript', () => {
  it('provides three complete frontend-only Talk mock rounds', () => {
    expect(LIVE_TALK_TRANSCRIPT_MOCK).toHaveLength(6);
    expect(LIVE_TALK_TRANSCRIPT_MOCK.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(LIVE_TALK_TRANSCRIPT_MOCK.every((entry) => entry.final)).toBe(true);
  });

  it('renders transient direct Talk user and assistant bubbles with microphone markers', () => {
    render(
      <LiveTalkTranscript
        transcripts={[
          { role: 'user', text: 'Can you hear me?', final: true },
          { role: 'assistant', text: 'Yes, I can hear you.', final: false },
        ]}
      />,
    );

    expect(screen.getByTestId('live-talk-transcript')).toBeInTheDocument();
    expect(screen.getByTestId('live-talk-user-message')).toHaveTextContent('Can you hear me?');
    expect(screen.getByTestId('live-talk-assistant-message')).toHaveTextContent('Yes, I can hear you.');
    expect(screen.getByLabelText('Voice input')).toBeInTheDocument();
    expect(screen.getByLabelText('Voice response')).toBeInTheDocument();
  });
});
