// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.1 restart recovery compatibility', () => {
  it('uses vanilla 8.1 recovery fixes instead of a content-hashed runtime patch', async () => {
    const [workspace, changelog] = await Promise.all([
      readFile(resolve(process.cwd(), 'pnpm-workspace.yaml'), 'utf8'),
      readFile(resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'), 'utf8'),
    ]);

    expect(workspace).not.toContain('patchedDependencies');
    expect(changelog).toContain('## 2026.8.1');
    expect(changelog).toContain('Shared history and recovery:');
    expect(changelog).toContain('Interrupted delivery:');
    expect(changelog).toContain('Restart recovery delivery:');
    expect(changelog).toContain('Gateway in-process restarts:');
  });
});
