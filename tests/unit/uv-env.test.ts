// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(path.join(tmpdir(), 'clawx-uv-env-'));
  vi.resetModules();

  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('os')>('os');
    return {
      ...actual,
      homedir: () => tempHome,
    };
  });

  vi.doMock('electron', () => ({
    app: {
      getLocale: vi.fn().mockReturnValue('en-US'),
      getPath: vi.fn().mockReturnValue(path.join(tempHome, '.clawx')),
      getAppPath: vi.fn().mockReturnValue(process.cwd()),
      getVersion: vi.fn().mockReturnValue('0.0.0-test'),
      isPackaged: false,
      isReady: vi.fn().mockReturnValue(true),
      whenReady: vi.fn().mockResolvedValue(undefined),
    },
  }));

  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
    resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }),
  }) as Intl.DateTimeFormat);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('uv mirror environment', () => {
  it('writes a ClawX-managed uv.toml under ~/.openclaw and exposes it via UV_CONFIG_FILE', async () => {
    const { getUvMirrorEnv } = await import('@electron/utils/uv-env');

    const env = await getUvMirrorEnv();

    const expectedPath = path.join(tempHome, '.openclaw', 'clawx', 'uv.toml');
    expect(env.UV_INDEX_URL).toBe('https://pypi.tuna.tsinghua.edu.cn/simple/');
    expect(env.UV_PYTHON_INSTALL_MIRROR).toBe('https://registry.npmmirror.com/-/binary/python-build-standalone/');
    expect(env.UV_CONFIG_FILE).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf-8')).toContain('index-url = "https://pypi.tuna.tsinghua.edu.cn/simple/"');
    expect(readFileSync(expectedPath, 'utf-8')).toContain('python-install-mirror = "https://registry.npmmirror.com/-/binary/python-build-standalone/"');
  });
});
