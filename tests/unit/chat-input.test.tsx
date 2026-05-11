import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { TooltipProvider } from '@/components/ui/tooltip';
import { hostApiFetch } from '@/lib/host-api';

const { agentsState, chatState, gatewayState, providersState, artifactPanelMocks } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    updateAgentModel: vi.fn(),
  },
  chatState: {
    currentAgentId: 'main',
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
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
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

function translate(key: string, vars?: Record<string, unknown>): string {
  switch (key) {
    case 'composer.attachFiles':
      return 'Attach files';
    case 'composer.pickSkill':
      return 'Choose skill';
    case 'composer.skillButton':
      return 'Skill';
    case 'composer.skillPickerTitle':
      return `Quick skill access for ${String(vars?.agent ?? '')}`;
    case 'composer.skillSearchPlaceholder':
      return 'Search skills';
    case 'composer.skillLoading':
      return 'Loading skills...';
    case 'composer.skillEmpty':
      return 'No matching skills found';
    case 'composer.pickAgent':
      return 'Choose agent';
    case 'composer.clearTarget':
      return 'Clear target agent';
    case 'composer.targetChip':
      return `@${String(vars?.agent ?? '')}`;
    case 'composer.agentPickerTitle':
      return 'Route the next message to another agent';
    case 'composer.gatewayDisconnectedPlaceholder':
      return 'Gateway not connected...';
    case 'composer.send':
      return 'Send';
    case 'composer.stop':
      return 'Stop';
    case 'composer.gatewayConnected':
      return 'connected';
    case 'composer.gatewayStatus':
      return `gateway ${String(vars?.state ?? '')} | port: ${String(vars?.port ?? '')} ${String(vars?.pid ?? '')}`.trim();
    case 'composer.retryFailedAttachments':
      return 'Retry failed attachments';
    case 'composer.skillPreviewTooltip':
      return 'Preview SKILL.md';
    case 'composer.skillPreviewNotFound':
      return 'Skill not found';
    default:
      return key;
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

function renderChatInput(onSend = vi.fn()) {
  return render(
    <TooltipProvider>
      <ChatInput onSend={onSend} />
    </TooltipProvider>,
  );
}

describe('ChatInput agent targeting', () => {
  beforeEach(() => {
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockReset();
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', port: 18789 };
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.defaultAccountId = null;
    providersState.refreshProviderSnapshot.mockReset();
    vi.mocked(hostApiFetch).mockReset();
    artifactPanelMocks.openPreview.mockReset();
  });

  it('hides the @agent picker when only one agent is configured', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    expect(screen.queryByTitle('Choose agent')).not.toBeInTheDocument();
  });

  it('uses native textarea rendering when no skill token is present', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: '我没有填写Skill' } });

    expect(textbox).toHaveValue('我没有填写Skill');
    expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();
    expect(textbox.className).not.toContain('text-transparent');
  });

  it('lets the user select an agent target and sends it with the message', () => {
    const onSend = vi.fn();
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    renderChatInput(onSend);

    fireEvent.click(screen.getByTitle('Choose agent'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getByText('@Research')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello direct agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
  });

  it('disables the input while gateway is running but not yet ready', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    expect(screen.getByTestId('chat-composer-input')).toBeDisabled();
  });

  it('shows starting status while gateway is running but not yet ready', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    expect(screen.getByText(/gateway starting \| port: 18789/i)).toBeInTheDocument();
  });

  it('renders the skill trigger after the @ agent picker', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    renderChatInput();

    const agentTrigger = screen.getByTestId('chat-composer-agent');
    const skillTrigger = screen.getByTestId('chat-composer-skill');

    expect(skillTrigger).toHaveTextContent('Skill');
    expect(agentTrigger.compareDocumentPosition(skillTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('inserts the selected skill at the current cursor position and prefixes sends', async () => {
    const onSend = vi.fn();
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput(onSend);

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    expect(await screen.findByText('/create-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByText('/create-skill'));
    expect(screen.getByTestId('chat-composer-skill')).toHaveTextContent('Skill');
    expect(textbox).toHaveValue('Draft /create-skill  a new helper');
    expect(screen.getByTestId('chat-composer-skill-token')).toHaveTextContent('/create-skill');

    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Draft /create-skill  a new helper', undefined, null);
    expect(hostApiFetch).toHaveBeenCalledWith(
      '/api/skills/quick-access',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
  });

  it('removes the full inline skill token with one backspace', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    expect(textbox).toHaveValue('Draft /create-skill  a new helper');
    textbox.setSelectionRange('Draft /create-skill  '.length, 'Draft /create-skill  '.length);
    fireEvent.keyDown(textbox, { key: 'Backspace' });

    expect(textbox).toHaveValue('Draft a new helper');
  });

  it('skips across the inline skill block with arrow keys', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    textbox.setSelectionRange('Draft '.length, 'Draft '.length);
    fireEvent.keyDown(textbox, { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textbox.selectionStart).toBe('Draft /create-skill  '.length);

    fireEvent.keyDown(textbox, { key: 'ArrowLeft' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textbox.selectionStart).toBe('Draft '.length);
  });

  it('adds left spacing when inserting a skill after adjacent text', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'docx',
          description: 'Work with Word documents.',
          source: 'legacy',
          sourceLabel: 'Legacy',
          manifestPath: '/tmp/openclaw/skills/docx/SKILL.md',
          baseDir: '/tmp/openclaw/skills/docx',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: '哈哈哈哈你好' } });
    textbox.focus();
    textbox.setSelectionRange('哈哈哈哈'.length, '哈哈哈哈'.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/docx'));

    expect(textbox).toHaveValue('哈哈哈哈 /docx  你好');
  });

  it('allows inserting the same skill multiple times as separate blocks', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-rule',
          description: 'Create Cursor rules.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-rule/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-rule',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-rule'));

    textbox.setSelectionRange(textbox.value.length, textbox.value.length);
    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-rule'));

    expect(textbox).toHaveValue('/create-rule  /create-rule  ');
    expect(screen.getAllByTestId('chat-composer-skill-token')).toHaveLength(2);
  });

  it('opens the artifact preview panel when the inline skill token is clicked', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    fireEvent.click(screen.getByTestId('chat-composer-skill-token'));

    expect(artifactPanelMocks.openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/workspace/skill/create-skill/SKILL.md',
        fileName: 'SKILL.md',
      }),
    );
  });
});
