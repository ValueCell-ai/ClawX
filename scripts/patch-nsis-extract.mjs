#!/usr/bin/env node
/**
 * Patch electron-builder's NSIS extractUsing7za macro to extract directly into
 * $INSTDIR instead of temp + CopyFiles.
 *
 * #1026 enlarged the packaged openclaw runtime; CopyFiles over thousands of
 * files makes assisted installers look frozen (~50%) and often fails with the
 * "app cannot be closed" retry dialog when AV or file locks are involved.
 *
 * Must run before makensis (package:win), not only in afterPack.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const EXTRACT_APP_PACKAGE_NSH = join(
  ROOT,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'include',
  'extractAppPackage.nsh',
);

const PATCHED_MACRO = [
  '!macro extractUsing7za FILE',
  '  ; ClawX-patched: extract directly to $INSTDIR (skip temp + CopyFiles).',
  '  StrCpy $R9 0',
  '  clawx_extract_attempt:',
  '    IntOp $R9 $R9 + 1',
  '    DetailPrint "Extracting ClawX application files (attempt $R9, please wait)..."',
  '    SetOutPath $INSTDIR',
  '    ClearErrors',
  '    Nsis7z::Extract "${FILE}"',
  '    IfErrors 0 clawx_extract_done',
  '    ${if} $R9 < 3',
  '      DetailPrint "Releasing file locks before retry..."',
  '      nsExec::ExecToStack \'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"\'',
  '      Pop $0',
  '      Pop $1',
  '      nsExec::ExecToStack \'taskkill /F /IM openclaw-gateway.exe\'',
  '      Pop $0',
  '      Pop $1',
  '      Sleep 3000',
  '      Goto clawx_extract_attempt',
  '    ${endIf}',
  '    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDRETRY IDRETRY clawx_extract_attempt IDCANCEL clawx_extract_abort',
  '  clawx_extract_abort:',
  '    Quit',
  '  clawx_extract_done:',
  '!macroend',
].join('\n');

/**
 * @param {string} [targetPath]
 * @returns {boolean} true when template is patched (or already patched)
 */
export function patchNsisExtractTemplate(targetPath = EXTRACT_APP_PACKAGE_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-extract] extractAppPackage.nsh not found, skipping.');
    return false;
  }

  const original = readFileSync(targetPath, 'utf8');
  if (original.includes('ClawX-patched')) {
    return true;
  }

  if (!original.includes('CopyFiles')) {
    console.warn('[patch-nsis-extract] CopyFiles not found — NSIS template may have changed.');
    return false;
  }

  // Use a replacer function so NSIS `${if}` tokens are not treated as replace groups.
  const patched = original.replace(
    /(!macro extractUsing7za FILE[\s\S]*?!macroend)/,
    () => PATCHED_MACRO,
  );

  if (patched === original) {
    console.warn('[patch-nsis-extract] extractUsing7za macro regex did not match.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-extract] Patched extractAppPackage.nsh (direct Nsis7z::Extract to $INSTDIR).');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = patchNsisExtractTemplate();
  process.exit(ok ? 0 : 1);
}
