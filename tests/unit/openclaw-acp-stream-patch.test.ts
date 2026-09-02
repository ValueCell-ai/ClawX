// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.2 ACP stream compatibility', () => {
  it('ships upstream delivery, duplication, and stream-order fixes', async () => {
    const changelog = await readFile(
      resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'),
      'utf8',
    );

    expect(changelog).toContain('## 2026.8.2');
    expect(changelog).toContain('Reply completion:');
    expect(changelog).toContain('Starting chats:');
    expect(changelog).toContain('Retained conversation inputs:');
  });
});
