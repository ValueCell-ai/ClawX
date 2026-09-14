import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockCpSync,
  mockMkdirSync,
  mockReadFileSync,
  mockReaddirSync,
  mockChmodSync,
  mockExecFileSync,
  mockSpawn,
  mockChildStdoutOn,
  mockChildStderrOn,
  mockChildOnce,
  mockChildKill,
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
  mockSpawn: vi.fn(),
  mockChildStdoutOn: vi.fn(),
  mockChildStderrOn: vi.fn(),
  mockChildOnce: vi.fn(),
  mockChildKill: vi.fn(),
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
  spawn: mockSpawn,
  default: { execFileSync: mockExecFileSync, spawn: mockSpawn },
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
    mockSpawn.mockReturnValue({
      stdout: { on: mockChildStdoutOn },
      stderr: { on: mockChildStderrOn },
      once: mockChildOnce,
      kill: mockChildKill,
      killed: false,
      exitCode: null,
    });
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

  it('parses the DingTalk device verification URL and code', async () => {
    const { parseDingTalkDwsDeviceOutput } = await import('@electron/utils/dingtalk-dws');
    const parsed = parseDingTalkDwsDeviceOutput(`
      链接: https://login.dingtalk.com/oauth2/device/verify.htm
      授权码: JHBH-CCFL
      https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JHBH-CCFL
      授权码将在 900 秒后过期。
    `);

    expect(parsed).toMatchObject({
      status: 'pending',
      verificationUri: 'https://login.dingtalk.com/oauth2/device/verify.htm',
      verificationUriComplete: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JHBH-CCFL',
      userCode: 'JHBH-CCFL',
    });
    expect(parsed?.expiresAt).toBeGreaterThan(Date.now() + 890_000);
  });

  it('parses the DingTalk loopback authorization URL', async () => {
    const { parseDingTalkDwsLoginOutput } = await import('@electron/utils/dingtalk-dws');
    const parsed = parseDingTalkDwsLoginOutput(`
      请在浏览器中完成扫码授权。
      https://login.dingtalk.com/oauth2/auth?client_id=ding-id&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback
    `);

    expect(parsed).toMatchObject({
      status: 'pending',
      verificationUriComplete: 'https://login.dingtalk.com/oauth2/auth?client_id=ding-id&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback',
    });
    expect(parsed?.userCode).toBeUndefined();
  });

  it('classifies safe device OAuth failure reasons without exposing CLI output', async () => {
    const { classifyDingTalkDwsOAuthError } = await import('@electron/utils/dingtalk-dws');

    expect(classifyDingTalkDwsOAuthError('error=user_not_allowed')).toBe('authorization_user_not_allowed');
    expect(classifyDingTalkDwsOAuthError('invalid_client: client secret incorrect')).toBe('authorization_invalid_client');
    expect(classifyDingTalkDwsOAuthError('该组织尚未开启 CLI 数据访问权限')).toBe('authorization_org_cli_disabled');
    expect(classifyDingTalkDwsOAuthError('permission denied: missing scope')).toBe('authorization_permission_denied');
    expect(classifyDingTalkDwsOAuthError('context deadline exceeded')).toBe('authorization_network_error');
    expect(classifyDingTalkDwsOAuthError('unknown failure')).toBe('authorization_failed');
  });

  it('starts desktop loopback OAuth with bot credentials only in the child environment', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value.includes('/tools/dingtalk-workspace-cli/bin/dws')
        || value.includes('/tools/dingtalk-workspace-cli/vendor/dws');
    });
    mockExecFileSync.mockReturnValue(JSON.stringify({ authenticated: false }));
    mockChildStdoutOn.mockImplementation((event: string, listener: (chunk: Buffer) => void) => {
      if (event === 'data') {
        queueMicrotask(() => listener(Buffer.from(
          '请在浏览器中完成扫码授权。\n'
          + 'https://login.dingtalk.com/oauth2/auth?client_id=ding-id&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback\n',
        )));
      }
    });

    const { cancelDingTalkDwsOAuth, startDingTalkDwsOAuth } = await import('@electron/utils/dingtalk-dws');
    await expect(startDingTalkDwsOAuth({ clientId: 'ding-id', clientSecret: 'ding-secret' }))
      .resolves.toMatchObject({ status: 'pending' });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/home/test/.openclaw/tools/dingtalk-workspace-cli/vendor/dws',
      ['auth', 'login', '--format', 'json'],
      expect.objectContaining({
        env: expect.objectContaining({
          DWS_CLIENT_ID: 'ding-id',
          DWS_CLIENT_SECRET: 'ding-secret',
        }),
      }),
    );
    expect(JSON.stringify(mockSpawn.mock.calls[0]?.[1])).not.toContain('ding-secret');
    cancelDingTalkDwsOAuth();
    expect(mockChildKill).toHaveBeenCalledWith('SIGTERM');
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
