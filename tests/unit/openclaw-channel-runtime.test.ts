// @vitest-environment node
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { patchDingTalkChannelIdsInJs } from '@electron/utils/dingtalk-plugin-compat';

it('loads enterprise channel entries against the actual installed SDK and retains account identities', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clawx-channel-contract-'));
  try {
    const source = await realpath(resolve('node_modules/@dingtalk-real-ai/dingtalk-connector'));
    const mirror = join(home, 'dingtalk');
    await cp(source, mirror, { recursive: true, filter: path => !path.slice(source.length).includes('node_modules') });
    async function patchEntries(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await patchEntries(file);
        else if (/\.(mjs|js)$/.test(entry.name)) {
          await writeFile(file, patchDingTalkChannelIdsInJs(await readFile(file, 'utf8')).content);
        }
      }
    }
    await patchEntries(mirror);
    await symlink(dirname(dirname(source)), join(mirror, 'node_modules'), 'junction');
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/openclaw-1010-channel-contract.mjs')], {
      timeout: 30_000,
      env: { ...process.env, CLAWX_DINGTALK_ENTRY: join(mirror, 'dist/index.mjs'), HOME: home, OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: home, OPENCLAW_CONFIG_PATH: join(home, 'openclaw.json') },
    });
    expect(stdout).toContain('contracts passed on OpenClaw 2026.10.10');
  } finally { await rm(home, { recursive: true, force: true }); }
}, 35_000);
