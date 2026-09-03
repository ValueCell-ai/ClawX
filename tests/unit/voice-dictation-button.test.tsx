import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  VoiceDictationButton,
  type VoiceDictationButtonProps,
} from '@/components/voice/VoiceDictationButton';

const hostApiFetchMock = vi.hoisted(() => vi.fn());
const hostApiDialogOpenMock = vi.hoisted(() => vi.fn());
const toastInfoMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

const voiceMock = vi.hoisted(() => ({
  state: {
    status: 'idle' as 'idle' | 'recording' | 'transcribing',
    elapsedSeconds: 0,
  },
  options: null as null | {
    disabled: boolean;
    onUnconfigured: () => void;
    onError: (code: string) => void;
    onTranscribed: (text: string) => void;
  },
  toggle: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/hooks/useVoiceDictation', () => ({
  VOICE_LEVEL_HISTORY: 24,
  useVoiceDictation: (options: NonNullable<typeof voiceMock.options>) => {
    voiceMock.options = options;
    return {
      status: voiceMock.state.status,
      elapsedSeconds: voiceMock.state.elapsedSeconds,
      toggle: voiceMock.toggle,
      cancel: voiceMock.cancel,
    };
  },
}));

const { agentsState, chatState, gatewayState, providersState, artifactPanelMocks } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    updateAgentModel: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
    currentSessionKey: 'agent:main:session-1',
    sessions: [{ key: 'agent:main:session-1' }],
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    error: null as string | null,
    refreshProviderSnapshot: vi.fn(),
  },
  artifactPanelMocks: {
    openPreview: vi.fn(),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelMocks) => unknown) => selector(artifactPanelMocks),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
  hostApi: {
    files: {
      stagePaths: (input: unknown) => hostApiFetchMock('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      stageBuffer: (input: unknown) => hostApiFetchMock('/api/files/stage-buffer', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    skills: {
      quickAccess: (input: unknown) => hostApiFetchMock('/api/skills/quick-access', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    },
    dialog: {
      open: hostApiDialogOpenMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    info: toastInfoMock,
    error: toastErrorMock,
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const VOICE_ERROR_COPY: Record<string, string> = {
  MIC_UNAVAILABLE: 'Microphone unavailable. Check system permissions.',
  TOO_SHORT: 'No speech captured.',
  NOT_CONFIGURED: 'Voice transcription is not configured.',
  AUTH: 'Invalid API key or insufficient permission.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  SERVER: 'Speech service is temporarily unavailable.',
  REQUEST: 'Voice request failed.',
  NETWORK: 'Cannot reach the speech service. Check network or Base URL.',
  EMPTY_RESULT: 'No speech recognized.',
  INVALID_INPUT: 'Invalid audio recording.',
};

function translate(key: string): string {
  if (key === 'composer.voiceInput') return 'Voice input';
  if (key === 'composer.voiceStop') return 'Stop recording';
  if (key === 'composer.voiceNotConfigured') {
    return 'Voice transcription is not configured. Open Models to set it up.';
  }
  if (key.startsWith('composer.voiceError.')) {
    return VOICE_ERROR_COPY[key.slice('composer.voiceError.'.length)] ?? key;
  }
  return key;
}

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: translate,
    i18n: { resolvedLanguage: 'en-US' },
  }),
}));

function renderVoiceButton(overrides: Partial<VoiceDictationButtonProps> = {}) {
  const props: VoiceDictationButtonProps = {
    status: 'idle',
    elapsedSeconds: 0,
    disabled: false,
    onToggle: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const utils = render(<VoiceDictationButton {...props} />);
  return { props, ...utils };
}

describe('VoiceDictationButton', () => {
  it('renders the mic button idle with a voice input title', () => {
    renderVoiceButton();

    const button = screen.getByTestId('chat-composer-voice');
    expect(button).toHaveAttribute('title', 'Voice input');
    expect(button.querySelector('.lucide-mic')).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('shows the stop icon and the m:ss elapsed label while recording', () => {
    renderVoiceButton({ status: 'recording', elapsedSeconds: 5 });

    const button = screen.getByTestId('chat-composer-voice');
    expect(button).toHaveAttribute('title', 'Stop recording');
    expect(button.querySelector('.lucide-square')).toBeInTheDocument();
    expect(button).toHaveTextContent('0:05');
    expect(button).not.toBeDisabled();
  });

  it('formats elapsed minutes as m:ss', () => {
    renderVoiceButton({ status: 'recording', elapsedSeconds: 65 });

    expect(screen.getByTestId('chat-composer-voice')).toHaveTextContent('1:05');
  });

  it('stops recording when clicked while recording', () => {
    const { props } = renderVoiceButton({ status: 'recording', elapsedSeconds: 3 });

    fireEvent.click(screen.getByTestId('chat-composer-voice'));

    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables the button with a spinning indicator while transcribing', () => {
    renderVoiceButton({ status: 'transcribing' });

    const button = screen.getByTestId('chat-composer-voice');
    expect(button).toBeDisabled();
    expect(button.querySelector('.lucide-loader-circle')).toHaveClass('animate-spin');
    expect(button).not.toHaveAttribute('title', 'Stop recording');
  });

  it('cancels recording with Escape while recording', () => {
    const { props } = renderVoiceButton({ status: 'recording', elapsedSeconds: 4 });

    fireEvent.keyDown(screen.getByTestId('chat-composer-voice'), { key: 'Escape' });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while idle', () => {
    const { props } = renderVoiceButton({ status: 'idle' });

    fireEvent.keyDown(screen.getByTestId('chat-composer-voice'), { key: 'Escape' });

    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('does not toggle when the disabled prop is set', () => {
    const { props } = renderVoiceButton({ disabled: true });

    fireEvent.click(screen.getByTestId('chat-composer-voice'));

    expect(props.onToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-composer-voice')).toBeDisabled();
  });
});

describe('VoiceDictationButton waveform', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWaveButton(
    overrides: Partial<VoiceDictationButtonProps> & { status: VoiceDictationButtonProps['status'] },
  ) {
    return render(
      <VoiceDictationButton
        elapsedSeconds={0}
        disabled={false}
        onToggle={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />,
    );
  }

  it('renders a 5-bar waveform strip between the stop icon and the timer while recording', () => {
    renderWaveButton({ status: 'recording', getLevels: () => new Array<number>(24).fill(0) });

    const button = screen.getByTestId('chat-composer-voice');
    const waveform = screen.getByTestId('chat-composer-voice-waveform');
    expect(button).toContainElement(waveform);
    expect(waveform.children).toHaveLength(5);
    for (const bar of Array.from(waveform.children)) {
      expect(bar).toHaveClass('w-[3px]');
      expect(bar).toHaveClass('rounded-full');
    }
    expect(button).toHaveTextContent('0:00');
  });

  it('updates bar heights from polled levels after advancing timers ~120ms', () => {
    vi.useFakeTimers();
    const levels = new Array<number>(24).fill(0);
    renderWaveButton({ status: 'recording', getLevels: () => levels });

    const readHeights = () =>
      Array.from(screen.getByTestId('chat-composer-voice-waveform').children).map(
        (bar) => (bar as HTMLElement).style.height,
      );

    expect(readHeights()).toEqual(['4px', '4px', '4px', '4px', '4px']);

    levels.fill(1);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(readHeights()).toEqual(['18px', '18px', '18px', '18px', '18px']);

    levels.fill(0.5);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(readHeights()).toEqual(['11px', '11px', '11px', '11px', '11px']);
  });

  it('maps level samples onto 5 buckets so bars scroll with history', () => {
    vi.useFakeTimers();
    const levels = new Array<number>(24).fill(0);
    levels[23] = 1;
    renderWaveButton({ status: 'recording', getLevels: () => levels });

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByTestId('chat-composer-voice-waveform').lastElementChild).toHaveStyle({
      height: '18px',
    });
  });

  it('shows no waveform and does not poll levels while idle or transcribing', () => {
    const getLevels = vi.fn(() => new Array<number>(24).fill(1));

    const idle = renderWaveButton({ status: 'idle', getLevels });
    expect(screen.queryByTestId('chat-composer-voice-waveform')).not.toBeInTheDocument();
    expect(getLevels).not.toHaveBeenCalled();
    idle.unmount();

    renderWaveButton({ status: 'transcribing', getLevels });
    expect(screen.queryByTestId('chat-composer-voice-waveform')).not.toBeInTheDocument();
    expect(getLevels).not.toHaveBeenCalled();
  });

  it('stops polling getLevels once recording ends', () => {
    vi.useFakeTimers();
    const getLevels = vi.fn(() => new Array<number>(24).fill(0));
    const { rerender } = renderWaveButton({ status: 'recording', getLevels });

    act(() => {
      vi.advanceTimersByTime(120);
    });
    const callsWhileRecording = getLevels.mock.calls.length;
    expect(callsWhileRecording).toBeGreaterThan(0);

    rerender(
      <VoiceDictationButton
        status="idle"
        elapsedSeconds={0}
        disabled={false}
        onToggle={vi.fn()}
        onCancel={vi.fn()}
        getLevels={getLevels}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(480);
    });
    expect(getLevels).toHaveBeenCalledTimes(callsWhileRecording);
  });
});

describe('ChatInput voice dictation wiring', () => {
  function renderChatInput() {
    return render(
      <TooltipProvider delayDuration={0}>
        <ChatInput onSend={vi.fn()} />
      </TooltipProvider>,
    );
  }

  beforeEach(() => {
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockReset();
    chatState.currentAgentId = 'main';
    chatState.currentSessionKey = 'agent:main:session-1';
    chatState.sessions = [{ key: 'agent:main:session-1' }];
    gatewayState.status = { state: 'running', port: 18789 };
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.defaultAccountId = null;
    providersState.error = null;
    providersState.refreshProviderSnapshot.mockReset();
    vi.mocked(hostApiFetchMock).mockReset();
    vi.mocked(hostApiFetchMock).mockResolvedValue({ success: true, skills: [] });
    vi.mocked(hostApiDialogOpenMock).mockReset();
    toastInfoMock.mockReset();
    toastErrorMock.mockReset();
    navigateMock.mockReset();
    artifactPanelMocks.openPreview.mockReset();
    voiceMock.state.status = 'idle';
    voiceMock.state.elapsedSeconds = 0;
    voiceMock.options = null;
    voiceMock.toggle.mockReset();
    voiceMock.cancel.mockReset();
  });

  it('renders the voice button after the attach button and toggles on click', () => {
    renderChatInput();

    const attach = screen.getByTitle('composer.attachFiles');
    const voice = screen.getByTestId('chat-composer-voice');

    expect(attach.compareDocumentPosition(voice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(voice);

    expect(voiceMock.toggle).toHaveBeenCalledTimes(1);
  });

  it('inserts transcribed text at the cursor and restores focus and caret', async () => {
    renderChatInput();

    const textarea = screen.getByTestId('chat-composer-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Draft a helper' } });
    textarea.focus();
    textarea.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTestId('chat-composer-voice'));
    act(() => {
      voiceMock.options?.onTranscribed('hello world');
    });

    await waitFor(() => {
      expect(textarea).toHaveValue('Draft hello worlda helper');
    });
    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
    await waitFor(() => {
      expect(textarea.selectionStart).toBe('Draft hello world'.length);
      expect(textarea.selectionEnd).toBe('Draft hello world'.length);
    });
  });

  it('locks the composer textarea while voice status is active', () => {
    const { rerender } = renderChatInput();

    expect(screen.getByTestId('chat-composer-input')).not.toBeDisabled();

    voiceMock.state.status = 'recording';
    rerender(
      <TooltipProvider delayDuration={0}>
        <ChatInput onSend={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-composer-input')).toBeDisabled();

    voiceMock.state.status = 'transcribing';
    rerender(
      <TooltipProvider delayDuration={0}>
        <ChatInput onSend={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-composer-input')).toBeDisabled();
    expect(screen.getByTestId('chat-composer-voice')).toBeDisabled();

    voiceMock.state.status = 'idle';
    rerender(
      <TooltipProvider delayDuration={0}>
        <ChatInput onSend={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('chat-composer-input')).not.toBeDisabled();
  });

  it('passes the composer disabled state into the dictation options', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ChatInput onSend={vi.fn()} sending />
      </TooltipProvider>,
    );

    expect(voiceMock.options?.disabled).toBe(true);
  });

  it('announces unconfigured voice setup and routes to the models voice tab', () => {
    renderChatInput();

    voiceMock.options?.onUnconfigured();

    expect(toastInfoMock).toHaveBeenCalledWith('Voice transcription is not configured. Open Models to set it up.');
    expect(navigateMock).toHaveBeenCalledWith('/models?tab=voice');
  });

  it('maps voice error codes to localized toast messages', () => {
    renderChatInput();

    voiceMock.options?.onError('AUTH');
    expect(toastErrorMock).toHaveBeenCalledWith('Invalid API key or insufficient permission.');

    voiceMock.options?.onError('NETWORK');
    expect(toastErrorMock).toHaveBeenCalledWith('Cannot reach the speech service. Check network or Base URL.');
  });
});
