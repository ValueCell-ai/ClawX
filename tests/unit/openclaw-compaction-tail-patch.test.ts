// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.1 compaction compatibility', () => {
  it('accepts ClawX canonical settings and rejects retired patch fields', async () => {
    const entry = resolve(process.cwd(), 'node_modules/openclaw/openclaw.mjs');
    const stateDir = await mkdtemp(join(tmpdir(), 'clawx-openclaw-schema-'));
    const validate = () => spawnSync(process.execPath, [
      entry,
      'config',
      'validate',
      '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
    });

    try {
      await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify({
        agents: {
          defaults: {
            compaction: {
              keepRecentTokens: 1,
              recentTurnsPreserve: 0,
              identifierPolicy: 'strict',
              midTurnPrecheck: { enabled: true },
            },
          },
        },
      }));
      expect(validate().status).toBe(0);

      await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify({
        agents: { defaults: { compaction: { reserveTokensFloor: 50_000 } } },
      }));
      expect(validate().status).not.toBe(0);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 30_000);
});
