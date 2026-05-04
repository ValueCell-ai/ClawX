import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const { mockExec } = vi.hoisted(() => ({
  mockExec: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: mockExec,
  default: {
    exec: mockExec,
  },
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  createAgent: vi.fn(),
  deleteAgentConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
  removeAgentWorkspaceDirectory: vi.fn(),
  resolveAccountIdForAgent: vi.fn(),
  updateAgentModel: vi.fn(),
  updateAgentName: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  deleteChannelAccountConfig: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: vi.fn(),
  syncAgentModelOverrideToRuntime: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: vi.fn(),
}));

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

describe('restartGatewayForAgentDeletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockExec.mockImplementation((_cmd: string, _opts: object, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, '');
      return {} as never;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('uses taskkill tree strategy on Windows when gateway pid is known', async () => {
    setPlatform('win32');
    const { restartGatewayForAgentDeletion } = await import('@electron/api/routes/agents');

    const restart = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn(() => ({ pid: 4321, port: 18789 }));

    await restartGatewayForAgentDeletion({
      gatewayManager: {
        getStatus,
        restart,
      },
    } as never);

    expect(mockExec).toHaveBeenCalledWith(
      'taskkill /F /PID 4321 /T',
      expect.any(Function),
    );
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('handleAgentRoutes model updates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it.each(['linux', 'darwin', 'win32'])(
    'updates model config without gateway reload or restart on %s',
    async (platform) => {
      setPlatform(platform);
      const routeUtils = await import('@electron/api/route-utils');
      const agentConfig = await import('@electron/utils/agent-config');
      const runtimeSync = await import('@electron/services/providers/provider-runtime-sync');
      const { handleAgentRoutes } = await import('@electron/api/routes/agents');

      vi.mocked(routeUtils.parseJsonBody).mockResolvedValue({ modelRef: 'custom-alpha/model-alpha' });
      vi.mocked(agentConfig.updateAgentModel).mockResolvedValue({
        agents: [],
        defaultAgentId: 'main',
        defaultModelRef: 'custom-alpha/model-alpha',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      });
      vi.mocked(runtimeSync.syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
      vi.mocked(runtimeSync.syncAgentModelOverrideToRuntime).mockResolvedValue(undefined);

      const gatewayManager = {
        getStatus: vi.fn(() => ({ state: 'running', pid: 1234, port: 18789 })),
        debouncedReload: vi.fn(),
        debouncedRestart: vi.fn(),
        restart: vi.fn(),
      };

      const handled = await handleAgentRoutes(
        { method: 'PUT' } as never,
        {} as never,
        new URL('http://127.0.0.1/api/agents/main/model'),
        { gatewayManager } as never,
      );

      expect(handled).toBe(true);
      expect(agentConfig.updateAgentModel).toHaveBeenCalledWith('main', 'custom-alpha/model-alpha');
      expect(runtimeSync.syncAllProviderAuthToRuntime).toHaveBeenCalledTimes(1);
      expect(runtimeSync.syncAgentModelOverrideToRuntime).toHaveBeenCalledWith('main');
      expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
      expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
      expect(gatewayManager.restart).not.toHaveBeenCalled();
      expect(routeUtils.sendJson).toHaveBeenCalledWith(
        {},
        200,
        expect.objectContaining({ success: true }),
      );
    },
  );
});
