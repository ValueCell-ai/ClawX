// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  patchNsisExtractTemplate,
  restoreExtractAppPackageTemplate,
} from '../../scripts/patch-nsis-extract.mjs';
import { patchNsisUninstallTemplate } from '../../scripts/patch-nsis-uninstall.mjs';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

const SAMPLE_EXTRACT_MACRO = `!macro extractUsing7za FILE
  Push $OUTDIR
  CopyFiles /SILENT "$PLUGINSDIR\\\\7z-out\\\\*" $OUTDIR
!macroend`;

const SAMPLE_FILE = `!macro ia32_app_files
  File /oname=$PLUGINSDIR\\\\app-32.7z "\\\${APP_32}"
!macroend

${SAMPLE_EXTRACT_MACRO}

!macro decompress
  !ifdef ZIP_COMPRESSION
    Quit
  !else
    !insertmacro extractUsing7za "$PLUGINSDIR\\\\app-$packageArch.7z"
  !endif
!macroend
`;

const SAMPLE_UNINSTALL_FUNCTION = readFileSync(
  join(FIXTURES, 'installUtil-unpatched.snippet.nsh'),
  'utf8',
);

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
    writeFileSync(target, SAMPLE_FILE, 'utf8');

    expect(patchNsisExtractTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('ClawX-patched-v2');
    expect(result).not.toContain('CopyFiles /SILENT');
    expect(result).not.toContain('$(appCannotBeClosed)');
    expect(result).toContain('$(decompressionFailed)');
    expect(result).toContain('Quit');
    expect(result).toContain('SetErrorLevel 2');
    expect(result).toContain('Restoring previous ClawX installation after failed update');
    expect(result).not.toContain('continuing overwrite install anyway');
    expect(patchNsisExtractTemplate(target)).toBe(true);
  });

  it('upgrades stale ClawX extract patches that used to continue after extract failure', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(
      target,
      SAMPLE_FILE.replace(
        SAMPLE_EXTRACT_MACRO,
        `!macro extractUsing7za FILE
  ; ClawX-patched: extract directly to $INSTDIR.
  ClearErrors
  Nsis7z::Extract "\${FILE}"
  DetailPrint "Extract reported file locks; continuing overwrite install anyway..."
!macroend`,
      ),
      'utf8',
    );

    expect(patchNsisExtractTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('ClawX-patched-v2');
    expect(result).toContain('Failed to extract ClawX files after multiple attempts.');
    expect(result).toContain('$(decompressionFailed)');
    expect(result).toContain('Quit');
    expect(result).toContain('SetErrorLevel 2');
    expect(result).toContain('Restoring previous ClawX installation after failed update');
    expect(result).not.toContain('continuing overwrite install anyway');
  });

  it('restores and re-patches a corrupted template', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(
      target,
      `${SAMPLE_FILE}\nMessageBox MB_RETRYCANCEL "$(appCannotBeClosed)"\n!macro extractUsing7za FILE\n  broken\n!macroend\n`,
      'utf8',
    );

    const restored = restoreExtractAppPackageTemplate(readFileSync(target, 'utf8'));
    expect(restored).not.toContain('broken');
    expect(restored).not.toContain('$(appCannotBeClosed)');

    writeFileSync(target, restored, 'utf8');
    expect(patchNsisExtractTemplate(target)).toBe(true);
    expect(readFileSync(target, 'utf8').match(/!macro extractUsing7za FILE/g)).toHaveLength(1);
  });
});

describe('patch-nsis-uninstall', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('skips the legacy uninstaller retry loop on upgrades', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'installUtil.nsh');
    writeFileSync(target, `before\n${SAMPLE_UNINSTALL_FUNCTION}\nafter`, 'utf8');

    expect(patchNsisUninstallTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('Skipping legacy uninstaller');
    expect(result).not.toContain('MessageBox MB_RETRYCANCEL');
    expect(patchNsisUninstallTemplate(target)).toBe(true);
  });
});
