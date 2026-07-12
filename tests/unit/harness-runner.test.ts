import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runStep } from '../../harness/src/runner.mjs';
import { ROOT } from '../../harness/src/specs.mjs';

describe('harness runner', () => {
  it('runs profile commands from the repository root', async () => {
    const originalCwd = process.cwd();

    try {
      process.chdir(path.join(ROOT, 'harness'));

      const result = await runStep({
        name: 'Check child cwd',
        command: process.execPath,
        args: ['-e', `process.exit(process.cwd() === ${JSON.stringify(ROOT)} ? 0 : 1)`],
      });

      expect(result.status).toBe('pass');
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
