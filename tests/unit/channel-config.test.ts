import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockedHomeDir = '';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const mocked = {
    ...actual,
    homedir: () => mockedHomeDir,
  };
  return {
    ...mocked,
    default: mocked,
  };
});


async function withChannelConfigModule<T>(
  tempHome: string,
  run: (mod: typeof import('@electron/utils/channel-config')) => Promise<T>,
): Promise<T> {
  mockedHomeDir = tempHome;
  vi.resetModules();
  const mod = await import('@electron/utils/channel-config');
  return await run(mod);
}

describe('channel-config wecom plugin id normalization', () => {
  const tempHomes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempHomes.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('writes canonical wecom plugin id on save', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'clawx-channel-config-'));
    tempHomes.push(tempHome);

    await withChannelConfigModule(tempHome, async ({ saveChannelConfig }) => {
      await saveChannelConfig('wecom', {
        botId: 'bot-id',
        secret: 'bot-secret',
        enabled: true,
      });
    });

    const configPath = join(tempHome, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      plugins?: { allow?: string[] };
    };

    expect(config.plugins?.allow).toContain('wecom');
    expect(config.plugins?.allow).not.toContain('wecom-openclaw-plugin');
  });

  it('replaces legacy wecom plugin id with canonical id', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'clawx-channel-config-'));
    tempHomes.push(tempHome);

    const openclawDir = join(tempHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify(
        {
          plugins: {
            enabled: true,
            allow: ['wecom-openclaw-plugin', 'dingtalk'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await withChannelConfigModule(tempHome, async ({ saveChannelConfig }) => {
      await saveChannelConfig('wecom', {
        botId: 'bot-id',
        secret: 'bot-secret',
        enabled: true,
      });
    });

    const configPath = join(tempHome, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      plugins?: { allow?: string[] };
    };
    const allow = config.plugins?.allow ?? [];

    expect(allow).toContain('wecom');
    expect(allow).toContain('dingtalk');
    expect(allow).not.toContain('wecom-openclaw-plugin');
  });
});