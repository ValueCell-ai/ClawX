#!/usr/bin/env node
/**
 * Apply all ClawX NSIS template patches before makensis (package:win).
 */

import { fileURLToPath } from 'node:url';
import { patchNsisExtractTemplate } from './patch-nsis-extract.mjs';
import { patchNsisInstallSectionTemplate } from './patch-nsis-install-section.mjs';
import { patchNsisUninstallTemplate } from './patch-nsis-uninstall.mjs';

const extractOk = patchNsisExtractTemplate();
const installSectionOk = patchNsisInstallSectionTemplate();
const uninstallOk = patchNsisUninstallTemplate();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(extractOk && installSectionOk && uninstallOk ? 0 : 1);
}
