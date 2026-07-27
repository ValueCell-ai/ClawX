import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatToolbar } from '@/pages/Chat/ChatToolbar';

const { agentsState, artifactPanelState, chatState } = vi.hoisted(() => ({
  agentsState: { agents: [{ id: 'main', name: 'Main' }] },
  artifactPanelState: {
    open: false,
    tab: 'changes',
    openBrowser: vi.fn(),
    close: vi.fn(),
  },
  chatState: { currentAgentId: 'main' },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'toolbar.currentAgent': 'Talking to Main',
      'toolbar.refresh': 'Refresh',
      'toolbar.workspace': 'Workspace',
      'questionDirectory.title': 'Question directory',
    })[key] ?? key,
  }),
}));

function renderToolbar(props: React.ComponentProps<typeof ChatToolbar> = {}) {
  return render(
    <TooltipProvider>
      <ChatToolbar {...props} />
    </TooltipProvider>,
  );
}

describe('ChatToolbar', () => {
  beforeEach(() => {
    artifactPanelState.open = false;
    artifactPanelState.tab = 'changes';
  });

  it('does not expose the removed refresh action', () => {
    renderToolbar();

    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.getByText('Talking to Main')).toBeInTheDocument();
  });
});
