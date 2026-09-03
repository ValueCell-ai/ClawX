// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.2 ACP compaction compatibility', () => {
  it('ships upstream compaction lifecycle and recovery fixes', async () => {
    const changelog = await readFile(
      resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'),
      'utf8',
    );

    expect(changelog).toContain('## 2026.8.2');
    expect(changelog).toContain('Conversation context:');
    expect(changelog).toContain('fix(compaction): stop repeated transcript byte compaction');
  });
});
