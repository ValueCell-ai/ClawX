import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Skills } from '@/pages/Skills';

const fetchSkillsMock = vi.fn();
const enableSkillMock = vi.fn();
const disableSkillMock = vi.fn();
const searchSkillsMock = vi.fn();
const installSkillMock = vi.fn();
const uninstallSkillMock = vi.fn();
const invokeIpcMock = vi.fn();

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as {
      state: string;
      port: number;
      gatewayReady?: boolean;
    },
  },
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    skills: [],
    loading: false,
    error: null,
    fetchSkills: fetchSkillsMock,
    enableSkill: enableSkillMock,
    disableSkill: disableSkillMock,
    searchResults: [],
    searchSkills: searchSkillsMock,
    installSkill: installSkillMock,
    uninstallSkill: uninstallSkillMock,
    searching: false,
    searchError: null,
    installing: {},
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('@/extensions/registry', () => ({
  rendererExtensionRegistry: {
    getSkillDetailMetaComponents: () => [],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Skills page gateway readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    invokeIpcMock.mockResolvedValue('/tmp/.openclaw/skills');
    fetchSkillsMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps loading skills while gatewayReady is false and hides the banner once skills fetch succeeds', async () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('skills-gateway-banner')).not.toBeInTheDocument();
  });

  it('shows a starting banner while the running gateway still cannot serve skills data', async () => {
    fetchSkillsMock.mockResolvedValue(false);
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<Skills />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(fetchSkillsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'starting');
  });

  it('shows stopped banner copy when the gateway is stopped', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };
    render(<Skills />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(screen.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'stopped');
    expect(fetchSkillsMock).not.toHaveBeenCalled();
  });
});
