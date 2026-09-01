// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.1 ACP stream compatibility', () => {
  it('ships upstream delivery, duplication, and stream-order fixes', async () => {
    const changelog = await readFile(
      resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'),
      'utf8',
    );

    expect(changelog).toContain('Chat duplication:');
    expect(changelog).toContain('Streamed commentary:');
    expect(changelog).toContain('Interrupted delivery:');
    expect(changelog).toContain('ACP timeout summaries:');
  });
});
