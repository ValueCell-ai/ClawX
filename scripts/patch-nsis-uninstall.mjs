#!/usr/bin/env node
/**
 * Patch electron-builder's uninstallOldVersion to skip the legacy uninstaller on
 * upgrades. customCheckAppRunning already kills processes and moves $INSTDIR
 * aside; running the old uninstaller often fails on locked openclaw bundles and
 * shows a misleading "app cannot be closed" dialog even when ClawX is not running.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const INSTALL_UTIL_NSH = join(
  ROOT,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'include',
  'installUtil.nsh',
);

const PATCH_MARKER = 'ClawX-patched: skip legacy uninstaller';

const SKIP_LEGACY_UNINSTALLER = [
  '  ; ClawX-patched: skip legacy uninstaller on upgrades.',
  '  ; customCheckAppRunning already killed processes and moved $INSTDIR aside.',
  '  DetailPrint "Skipping legacy uninstaller; continuing with overwrite install..."',
  '  ClearErrors',
  '  Return',
].join('\n');

const LEGACY_UNINSTALL_BLOCK =
  /  StrCpy \$uninstallerFileNameTemp "\$PLUGINSDIR\\old-uninstaller\.exe"[\s\S]*?  DoesNotExist:\r?\n    SetErrors\r?\nFunctionEnd/;

/**
 * @param {string} [targetPath]
 * @returns {boolean}
 */
export function patchNsisUninstallTemplate(targetPath = INSTALL_UTIL_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-uninstall] installUtil.nsh not found, skipping.');
    return false;
  }

  const original = readFileSync(targetPath, 'utf8');
  if (original.includes(PATCH_MARKER)) {
    return true;
  }

  if (!original.includes('Function uninstallOldVersion')) {
    console.warn('[patch-nsis-uninstall] uninstallOldVersion not found — template may have changed.');
    return false;
  }

  if (!LEGACY_UNINSTALL_BLOCK.test(original)) {
    console.warn('[patch-nsis-uninstall] Legacy uninstall block regex did not match.');
    return false;
  }

  const patched = original.replace(
    LEGACY_UNINSTALL_BLOCK,
    `${SKIP_LEGACY_UNINSTALLER}\nFunctionEnd`,
  );

  if (patched === original) {
    console.warn('[patch-nsis-uninstall] No changes applied.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-uninstall] Patched installUtil.nsh (skip legacy uninstaller on upgrade).');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = patchNsisUninstallTemplate();
  process.exit(ok ? 0 : 1);
}
