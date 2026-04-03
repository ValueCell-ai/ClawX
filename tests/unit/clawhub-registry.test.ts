/**
 * Tests for ClawHub China mirror registry switching logic.
 *
 * Verifies that when the app language starts with 'zh', the spawned ClawHub CLI
 * process receives CLAWHUB_REGISTRY=https://mirror-cn.clawhub.com, and that
 * non-Chinese locales do NOT set this variable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

/* ---------- hoisted mocks ---------- */
const {
  mockGetSetting,
  mockExistsSync,
  mockSpawn,
  mockEnsureDir,
} = vi.hoisted(() => ({
  mockGetSetting: vi.fn<() => Promise<string | undefined>>(),
  mockExistsSync: vi.fn<(p: string) => boolean>(),
  mockSpawn: vi.fn(),
  mockEnsureDir: vi.fn(),
}));

/* ---------- module mocks ---------- */
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, default: { ...actual, spawn: mockSpawn }, spawn: mockSpawn };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: mockExistsSync, readdirSync: vi.fn(() => []) },
    existsSync: mockExistsSync,
  };
});

vi.mock('electron', () => ({
  app: { get isPackaged() { return true; } },
  shell: { openPath: vi.fn() },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/test-openclaw',
  ensureDir: mockEnsureDir,
  getClawHubCliBinPath: () => '/tmp/clawhub-bin',
  getClawHubCliEntryPath: () => '/tmp/clawhub-entry.mjs',
  quoteForCmd: (s: string) => `"${s}"`,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

/* ---------- helpers ---------- */

/** Create a fake ChildProcess that emits stdout data then exits with code 0. */
function makeFakeChild(stdoutData: string = 'ok') {
  const child = new EventEmitter() as ReturnType<typeof import('child_process').spawn>;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (child as any).stdout = stdout;
  (child as any).stderr = stderr;

  // Simulate async output + successful exit
  queueMicrotask(() => {
    stdout.emit('data', Buffer.from(stdoutData));
    child.emit('close', 0);
  });

  return child;
}

/* ---------- test suite ---------- */

describe('ClawHub China mirror registry', () => {
  let spawnEnvCapture: Record<string, string | undefined> | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Default: CLI entry exists so constructor succeeds (useNodeRunner = true path)
    mockExistsSync.mockReturnValue(true);

    // Capture the env passed to spawn
    mockSpawn.mockImplementation((_cmd: string, _args: string[], opts: any) => {
      spawnEnvCapture = opts?.env;
      return makeFakeChild();
    });
  });

  afterEach(() => {
    spawnEnvCapture = undefined;
  });

  it('sets CLAWHUB_REGISTRY with HTTPS for zh-CN locale', async () => {
    mockGetSetting.mockResolvedValueOnce('zh-CN');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    // Use search as the trigger to invoke runCommand
    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBe('https://mirror-cn.clawhub.com');
  });

  it('sets CLAWHUB_REGISTRY with HTTPS for zh-TW locale', async () => {
    mockGetSetting.mockResolvedValueOnce('zh-TW');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBe('https://mirror-cn.clawhub.com');
  });

  it('sets CLAWHUB_REGISTRY with HTTPS for bare zh locale', async () => {
    mockGetSetting.mockResolvedValueOnce('zh');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBe('https://mirror-cn.clawhub.com');
  });

  it('does NOT set CLAWHUB_REGISTRY for en locale', async () => {
    mockGetSetting.mockResolvedValueOnce('en');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBeUndefined();
  });

  it('does NOT set CLAWHUB_REGISTRY for ja locale', async () => {
    mockGetSetting.mockResolvedValueOnce('ja');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBeUndefined();
  });

  it('does NOT set CLAWHUB_REGISTRY when language is undefined', async () => {
    mockGetSetting.mockResolvedValueOnce(undefined);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture).toBeDefined();
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toBeUndefined();
  });

  it('uses HTTPS, not HTTP, for the registry URL', async () => {
    mockGetSetting.mockResolvedValueOnce('zh-CN');

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    await service.search({ query: 'test' });

    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).toMatch(/^https:\/\//);
    expect(spawnEnvCapture!.CLAWHUB_REGISTRY).not.toMatch(/^http:\/\//);
  });
});
