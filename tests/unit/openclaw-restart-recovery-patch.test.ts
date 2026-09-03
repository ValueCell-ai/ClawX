// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OpenClaw 8.2 restart recovery compatibility', () => {
  it('uses vanilla 8.2 recovery fixes instead of a content-hashed runtime patch', async () => {
    const [workspace, changelog] = await Promise.all([
      readFile(resolve(process.cwd(), 'pnpm-workspace.yaml'), 'utf8'),
      readFile(resolve(process.cwd(), 'node_modules/openclaw/CHANGELOG.md'), 'utf8'),
    ]);

    expect(workspace).not.toContain('patchedDependencies');
    expect(changelog).toContain('## 2026.8.2');
    expect(changelog).toContain('Safe session recovery:');
    expect(changelog).toContain('Gateway restart after repair:');
    expect(changelog).toContain('Doctor maintenance:');
    expect(changelog).toContain('Update restart ordering:');
  });
});
