// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.1 ACP compaction compatibility', () => {
  it('ships upstream compaction lifecycle and recovery fixes', async () => {
    const changelog = await readFile(
      resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'),
      'utf8',
    );

    expect(changelog).toContain('Compaction:');
    expect(changelog).toContain('Compaction recovery and native session accounting:');
    expect(changelog).toContain('Control UI Codex compaction history:');
  });
});
