#!/usr/bin/env node
/**
 * Patch electron-builder's assisted install section so the app-running guard is
 * executed in the elevated UAC inner instance as well.
 *
 * electron-builder skips CHECK_APP_RUNNING for assisted installers when
 * UAC_IsInnerInstance is true. Per-machine upgrades run the actual file
 * replacement in that inner process, so the old ClawX.exe can remain alive,
 * keep $INSTDIR locked, and make the installer appear successful while the old
 * files remain installed.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const INSTALL_SECTION_NSH = join(
  ROOT,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'installSection.nsh',
);

const PATCH_MARKER = 'ClawX-patched-v2: run app-running guard in assisted UAC inner instance';

const ORIGINAL_ASSISTED_CHECK = [
  '!else',
  '  ${ifNot} ${UAC_IsInnerInstance}',
  '    !insertmacro CHECK_APP_RUNNING',
  '  ${endif}',
  '!endif',
].join('\n');

const PATCHED_ASSISTED_CHECK = [
  '!else',
  `  ; ${PATCH_MARKER}.`,
  '  ; Per-machine assisted upgrades perform the actual install in the elevated',
  '  ; UAC inner instance; skipping CHECK_APP_RUNNING there can leave ClawX.exe',
  '  ; alive and make the installer false-succeed with old files still present.',
  '  !insertmacro CHECK_APP_RUNNING',
  '!endif',
].join('\n');

function isTemplateHealthy(content) {
  return content.includes(PATCH_MARKER)
    && content.includes('!insertmacro CHECK_APP_RUNNING')
    && !content.includes(['  ${ifNot} ${UAC_IsInnerInstance}', '    !insertmacro CHECK_APP_RUNNING'].join('\n'));
}

/**
 * @param {string} [targetPath]
 * @returns {boolean}
 */
export function patchNsisInstallSectionTemplate(targetPath = INSTALL_SECTION_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-install-section] installSection.nsh not found, skipping.');
    return false;
  }

  const original = readFileSync(targetPath, 'utf8');
  if (isTemplateHealthy(original)) {
    return true;
  }

  if (!original.includes(ORIGINAL_ASSISTED_CHECK)) {
    console.warn('[patch-nsis-install-section] Assisted CHECK_APP_RUNNING block not found — template may have changed.');
    return false;
  }

  const patched = original.replace(ORIGINAL_ASSISTED_CHECK, PATCHED_ASSISTED_CHECK);
  if (patched === original) {
    console.warn('[patch-nsis-install-section] No changes applied.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-install-section] Patched installSection.nsh (run app guard in assisted UAC inner instance).');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = patchNsisInstallSectionTemplate();
  process.exit(ok ? 0 : 1);
}
