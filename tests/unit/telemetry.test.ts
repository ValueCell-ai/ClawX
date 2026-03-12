import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  shutdownMock,
  captureMock,
  getSettingMock,
  setSettingMock,
  loggerDebugMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  shutdownMock: vi.fn(),
  captureMock: vi.fn(),
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock() {
    return {
      capture: captureMock,
      shutdown: shutdownMock,
    };
  }),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: loggerDebugMock,
    error: loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.2.1',
  },
}));

vi.mock('node-machine-id', () => ({
  machineIdSync: () => 'machine-id-1',
}));

describe('main telemetry shutdown', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSettingMock.mockImplementation(async (key: string) => {
      switch (key) {
        case 'telemetryEnabled':
          return true;
        case 'machineId':
          return 'existing-machine-id';
        case 'hasReportedInstall':
          return true;
        default:
          return undefined;
      }
    });
    setSettingMock.mockResolvedValue(undefined);
    captureMock.mockReturnValue(undefined);
  });

  it('ignores PostHog network timeout errors during shutdown', async () => {
    shutdownMock.mockRejectedValueOnce(
      Object.assign(new Error('Network error while fetching PostHog'), {
        name: 'PostHogFetchNetworkError',
        cause: Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      }),
    );

    const { initTelemetry, shutdownTelemetry } = await import('@electron/utils/telemetry');
    await initTelemetry();
    await shutdownTelemetry();

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Ignored telemetry shutdown network error:',
      expect.objectContaining({ name: 'PostHogFetchNetworkError' }),
    );
  });
});
