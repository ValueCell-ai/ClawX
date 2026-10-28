// @vitest-environment node

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock('@electron/utils/openclaw-utility-process', () => ({ forkOpenClawUtilityProcess: mocks.fork }));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => process.cwd(),
  getOpenClawEntryPath: () => __filename,
}));
vi.mock('@electron/utils/uv-env', () => ({ getUvMirrorEnv: async () => ({}) }));

function fakeChild(stdout: string, code: number) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  setImmediate(() => {
    child.stdout.write(stdout);
    setImmediate(() => child.emit('exit', code));
  });
  return child;
}

describe('validateOpenClawConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.fork.mockReset();
  });

  it('reports the invalid config keys from the JSON report', async () => {
    mocks.fork.mockImplementation(() => fakeChild(JSON.stringify({
      ok: false,
      valid: false,
      issues: [
        { path: 'agents.defaults.compaction.identifierPolicy', message: 'Invalid input' },
        { path: 'session', message: 'Unrecognized key: "idleMinutes"' },
      ],
    }), 1));
    const { validateOpenClawConfig } = await import('@electron/utils/openclaw-command');

    await expect(validateOpenClawConfig()).resolves.toEqual({
      valid: false,
      summary: 'invalid keys: agents.defaults.compaction.identifierPolicy, session',
    });
    expect(mocks.fork).toHaveBeenCalledWith(__filename, ['config', 'validate', '--json'], expect.anything());
  });

  it('accepts a valid config', async () => {
    mocks.fork.mockImplementation(() => fakeChild('{"valid":true,"warnings":[]}', 0));
    const { validateOpenClawConfig } = await import('@electron/utils/openclaw-command');

    await expect(validateOpenClawConfig()).resolves.toEqual({ valid: true, summary: '' });
  });

  it('treats an unparseable failure as invalid', async () => {
    mocks.fork.mockImplementation(() => fakeChild('Cannot find module node-compile-cache.mjs', 1));
    const { validateOpenClawConfig } = await import('@electron/utils/openclaw-command');

    await expect(validateOpenClawConfig()).resolves.toEqual({
      valid: false,
      summary: 'Cannot find module node-compile-cache.mjs',
    });
  });
});
