import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileAtomic } from '@electron/utils/atomic-write';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'atomic-write-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('writes new file and leaves no .tmp behind', async () => {
    const target = join(tmp, 'a.json');
    await writeFileAtomic(target, '{"x":1}');
    expect(await readFile(target, 'utf-8')).toBe('{"x":1}');
    let tmpExists = false;
    try { await stat(`${target}.tmp`); tmpExists = true; } catch { /* expected */ }
    expect(tmpExists).toBe(false);
  });

  it('replaces existing file fully (no half-written state)', async () => {
    const target = join(tmp, 'b.json');
    await writeFile(target, 'OLD CONTENT', 'utf-8');
    await writeFileAtomic(target, 'NEW CONTENT');
    expect(await readFile(target, 'utf-8')).toBe('NEW CONTENT');
  });

  it('writes large payloads correctly', async () => {
    const target = join(tmp, 'big.json');
    const big = JSON.stringify({ data: 'x'.repeat(100_000) });
    await writeFileAtomic(target, big);
    expect((await readFile(target, 'utf-8')).length).toBe(big.length);
  });

  it('preserves utf-8 encoding (Chinese chars)', async () => {
    const target = join(tmp, 'cn.json');
    await writeFileAtomic(target, '{"msg":"当前使用的模型来自 openai"}');
    const back = await readFile(target, 'utf-8');
    expect(back).toContain('当前使用的模型来自');
  });

  it('survives many concurrent writers without corruption', async () => {
    const target = join(tmp, 'concurrent.json');
    // Initial value
    await writeFileAtomic(target, '{"v":0}');
    // Fire 20 concurrent writes
    const writes = Array.from({ length: 20 }, (_, i) =>
      writeFileAtomic(target, JSON.stringify({ v: i + 1 })),
    );
    await Promise.all(writes);
    // Final file must be a valid JSON, value somewhere in [1..20]
    const out = JSON.parse(await readFile(target, 'utf-8'));
    expect(typeof out.v).toBe('number');
    expect(out.v).toBeGreaterThanOrEqual(1);
    expect(out.v).toBeLessThanOrEqual(20);
  });
});
