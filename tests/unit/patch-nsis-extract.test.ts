// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { patchNsisExtractTemplate } from '../../scripts/patch-nsis-extract.mjs';

const SAMPLE_MACRO = `!macro extractUsing7za FILE
  Push $OUTDIR
  CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR
!macroend`;

describe('patch-nsis-extract', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('replaces CopyFiles-based extractUsing7za with direct 7z extraction', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(target, `before\n${SAMPLE_MACRO}\nafter`, 'utf8');

    expect(patchNsisExtractTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('ClawX-patched');
    expect(result).not.toContain('CopyFiles /SILENT');
    expect(patchNsisExtractTemplate(target)).toBe(true);
  });
});
