import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkMsvcRuntime } from '@electron/utils/windows-runtime-check';

describe('checkMsvcRuntime', () => {
  it('returns applicable=false on non-Windows platforms', () => {
    const result = checkMsvcRuntime('linux');
    expect(result).toEqual({
      installed: false,
      missing: [],
      present: [],
      searchedDirs: [],
      platform: 'linux',
      applicable: false,
    });
  });

  it('reports all DLLs missing when system dirs are empty', () => {
    // Build a fake SystemRoot with empty System32 so the existsSync checks
    // all return false.  We override SystemRoot via env for this test.
    const fakeRoot = mkdtempSync(join(tmpdir(), 'clawx-msvc-'));
    mkdirSync(join(fakeRoot, 'System32'), { recursive: true });
    mkdirSync(join(fakeRoot, 'SysWOW64'), { recursive: true });
    const originalRoot = process.env.SystemRoot;
    const originalWindir = process.env.WINDIR;

    try {
      process.env.SystemRoot = fakeRoot;
      delete process.env.WINDIR;
      const result = checkMsvcRuntime('win32');
      expect(result.applicable).toBe(true);
      expect(result.installed).toBe(false);
      expect(result.missing.sort()).toEqual([
        'MSVCP140.dll',
        'VCRUNTIME140.dll',
        'VCRUNTIME140_1.dll',
      ]);
      expect(result.present).toEqual([]);
      expect(result.searchedDirs).toEqual([
        join(fakeRoot, 'System32'),
        join(fakeRoot, 'SysWOW64'),
      ]);
    } finally {
      if (originalRoot !== undefined) process.env.SystemRoot = originalRoot;
      else delete process.env.SystemRoot;
      if (originalWindir !== undefined) process.env.WINDIR = originalWindir;
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('reports installed=true when all DLLs exist in System32', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'clawx-msvc-ok-'));
    const sys32 = join(fakeRoot, 'System32');
    mkdirSync(sys32, { recursive: true });
    mkdirSync(join(fakeRoot, 'SysWOW64'), { recursive: true });
    for (const dll of ['VCRUNTIME140.dll', 'MSVCP140.dll', 'VCRUNTIME140_1.dll']) {
      writeFileSync(join(sys32, dll), 'x');
    }
    const original = process.env.SystemRoot;
    try {
      process.env.SystemRoot = fakeRoot;
      const result = checkMsvcRuntime('win32');
      expect(result.installed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.present.sort()).toEqual([
        'MSVCP140.dll',
        'VCRUNTIME140.dll',
        'VCRUNTIME140_1.dll',
      ]);
    } finally {
      if (original !== undefined) process.env.SystemRoot = original;
      else delete process.env.SystemRoot;
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('falls back to SysWOW64 when a DLL is only there', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'clawx-msvc-wow-'));
    const sys32 = join(fakeRoot, 'System32');
    const wow64 = join(fakeRoot, 'SysWOW64');
    mkdirSync(sys32, { recursive: true });
    mkdirSync(wow64, { recursive: true });
    // Only place one DLL in SysWOW64 — the other two missing everywhere.
    writeFileSync(join(wow64, 'VCRUNTIME140.dll'), 'x');

    const original = process.env.SystemRoot;
    try {
      process.env.SystemRoot = fakeRoot;
      const result = checkMsvcRuntime('win32');
      expect(result.installed).toBe(false);
      expect(result.present).toEqual(['VCRUNTIME140.dll']);
      expect(result.missing.sort()).toEqual(['MSVCP140.dll', 'VCRUNTIME140_1.dll']);
    } finally {
      if (original !== undefined) process.env.SystemRoot = original;
      else delete process.env.SystemRoot;
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
