import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const existsSyncMock = vi.fn();
const ensureDirMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  default: {
    spawn: (...args: unknown[]) => spawnMock(...args),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => existsSyncMock(...args),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    promises: {
      rm: vi.fn(),
      writeFile: vi.fn(),
    },
  },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/openclaw',
  ensureDir: (...args: unknown[]) => ensureDirMock(...args),
  getClawHubCliBinPath: () => '/tmp/clawhub',
  getClawHubCliEntryPath: () => '/tmp/clawhub-entry.js',
  quoteForCmd: (value: string) => value,
}));

function createChildProcessMock() {
  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number | null) => void> = [];
  const errorHandlers: Array<(error: Error) => void> = [];

  return {
    stdout: {
      on: (event: string, handler: (chunk: Buffer) => void) => {
        if (event === 'data') stdoutHandlers.push(handler);
      },
    },
    stderr: {
      on: (event: string, handler: (chunk: Buffer) => void) => {
        if (event === 'data') void handler;
      },
    },
    on: (event: string, handler: ((code: number | null) => void) | ((error: Error) => void)) => {
      if (event === 'close') {
        closeHandlers.push(handler as (code: number | null) => void);
      }
      if (event === 'error') {
        errorHandlers.push(handler as (error: Error) => void);
      }
    },
    emitStdoutAndClose: (stdoutChunks: string[], code: number | null = 0) => {
      stdoutChunks.forEach((chunk) => {
        stdoutHandlers.forEach((handler) => handler(Buffer.from(chunk)));
      });
      closeHandlers.forEach((handler) => handler(code));
    },
    emitError: (error: Error) => {
      errorHandlers.forEach((handler) => handler(error));
    },
  };
}

describe('ClawHubService listInstalled cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
  });

  it('deduplicates in-flight listInstalled calls and reuses cached results', async () => {
    const child = createChildProcessMock();
    spawnMock.mockReturnValue(child);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const pending = Promise.all([
      service.listInstalled(),
      service.listInstalled(),
    ]);
    child.emitStdoutAndClose(['demo-skill v1.2.3\n']);
    const [first, second] = await pending;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        slug: 'demo-skill',
        version: '1.2.3',
        source: 'openclaw-managed',
        baseDir: '/tmp/openclaw/skills/demo-skill',
      },
    ]);

    const cached = await service.listInstalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(cached).toEqual(first);
  });

  it('invalidates the installed-skills cache after install and uninstall', async () => {
    const firstList = createChildProcessMock();
    const installRun = createChildProcessMock();
    const secondList = createChildProcessMock();
    const thirdList = createChildProcessMock();
    spawnMock
      .mockReturnValueOnce(firstList)
      .mockReturnValueOnce(installRun)
      .mockReturnValueOnce(secondList)
      .mockReturnValueOnce(thirdList);

    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();

    const initialListPromise = service.listInstalled();
    firstList.emitStdoutAndClose(['demo-skill v1.2.3\n']);
    await initialListPromise;

    const installPromise = service.install({ slug: 'demo-skill' });
    installRun.emitStdoutAndClose([]);
    await installPromise;

    const secondListPromise = service.listInstalled();
    secondList.emitStdoutAndClose(['demo-skill v1.2.3\n']);
    await secondListPromise;

    await service.uninstall({ slug: 'demo-skill' });
    const thirdListPromise = service.listInstalled();
    thirdList.emitStdoutAndClose(['demo-skill v1.2.3\n']);
    await thirdListPromise;

    expect(spawnMock).toHaveBeenCalledTimes(4);
  });
});
