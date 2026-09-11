import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockCpSync,
  mockMkdirSync,
  mockReadFileSync,
  mockReaddirSync,
  mockChmodSync,
  mockExecFileSync,
  mockHomedir,
  mockApp,
  mockSafeRmSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockChmodSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockHomedir: vi.fn(() => '/home/test'),
  mockApp: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/workspace'),
  },
  mockSafeRmSync: vi.fn(),
}));

vi.mock('node:fs', () => {
  const mocked = {
    chmodSync: mockChmodSync,
    cpSync: mockCpSync,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  default: { execFileSync: mockExecFileSync },
}));

vi.mock('node:os', () => {
  const mocked = {
    homedir: () => mockHomedir(),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@electron/utils/safe-fs', () => ({
  safeRmSync: mockSafeRmSync,
}));

describe('dingtalk dws helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    mockHomedir.mockReturnValue('/home/test');
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('extracts the vendor binary from the platform archive', async () => {
    const packageDir = '/workspace/node_modules/dingtalk-workspace-cli';
    let extracted = false;
    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value === `${packageDir}/assets/dws-linux-amd64.tar.gz`) return true;
      if (value === `${packageDir}/vendor/dws`) return extracted;
      return false;
    });
    mockCpSync.mockImplementation(() => {
      extracted = true;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'dws', isDirectory: () => false },
    ]);

    const { extractDingTalkDwsVendor } = await import('@electron/utils/dingtalk-dws');
    expect(extractDingTalkDwsVendor(packageDir, 'linux', 'x64')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'tar',
      ['-xzf', `${packageDir}/assets/dws-linux-amd64.tar.gz`, '-C', `${packageDir}/.dws-extract-tmp`],
      { stdio: 'ignore' },
    );
  });

  it('treats unauthenticated dws as a non-fatal office-skill warning', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value.includes('/tools/dingtalk-workspace-cli/bin/dws.js')
        || value.includes('/tools/dingtalk-workspace-cli/vendor/dws');
    });
    mockExecFileSync.mockReturnValue(JSON.stringify({ authenticated: false }));

    const { probeDingTalkDwsAuth, getDingTalkDwsStatusNote, DINGTALK_DWS_AUTH_REQUIRED } = await import('@electron/utils/dingtalk-dws');
    expect(probeDingTalkDwsAuth()).toBe('needs_auth');
    expect(getDingTalkDwsStatusNote()).toBe(DINGTALK_DWS_AUTH_REQUIRED);
  });
});
