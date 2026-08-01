import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron hardware acceleration policy', () => {
  it('does not force every renderer onto software compositing', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8');

    expect(source).not.toMatch(/disableHardwareAcceleration\s*\(/u);
    expect(source).not.toMatch(/appendSwitch\s*\(\s*['"]disable-gpu['"]/u);
  });
});
