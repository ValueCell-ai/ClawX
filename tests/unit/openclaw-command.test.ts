// @vitest-environment node

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  child: null as null | (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }),
}));

vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: () => true,
}));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/openclaw',
  getOpenClawEntryPath: () => '/openclaw/openclaw.mjs',
}));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@electron/utils/uv-env', () => ({ getUvMirrorEnv: async () => ({}) }));
vi.mock('@electron/utils/openclaw-utility-process', () => ({
  forkOpenClawUtilityProcess: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mocks.child = child;
    return child;
  },
}));

async function startCommand(options: Record<string, unknown>) {
  const { runOpenClawCommand } = await import('@electron/utils/openclaw-command');
  const result = runOpenClawCommand(['plugins', 'enable', 'wecom'], { label: 'test', timeoutMs: 60_000, ...options });
  await vi.waitFor(() => expect(mocks.child).not.toBeNull());
  return { result, child: mocks.child! };
}

describe('runOpenClawCommand completion output', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.child = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops a command that reported completion but stayed alive, and reports success', async () => {
    const { result, child } = await startCommand({
      completeWhen: (stdout: string) => stdout.includes('Enabled plugin "wecom".'),
      completionGraceMs: 50,
    });
    vi.useFakeTimers();

    child.stdout.emit('data', Buffer.from('Enabled plugin "wecom". Saved for the next Gateway start.\n'));
    await vi.advanceTimersByTimeAsync(60);

    await expect(result).resolves.toEqual(expect.objectContaining({
      success: true,
      exitCode: null,
      completedByOutput: true,
    }));
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('keeps the real exit status when the command exits within the grace period', async () => {
    const { result, child } = await startCommand({
      completeWhen: () => true,
      completionGraceMs: 1_000,
    });

    child.stdout.emit('data', Buffer.from('Enabled plugin "wecom".\n'));
    child.emit('exit', 0);

    await expect(result).resolves.toEqual(expect.objectContaining({ success: true, exitCode: 0 }));
    expect((await result).completedByOutput).toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
