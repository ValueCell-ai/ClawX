#!/usr/bin/env zx

import 'zx/globals';
import fs from 'fs';
import path from 'path';

// Disable verbose output
$.verbose = false;

async function ensureLibsignal() {
  const nodeModulesPath = path.resolve(__dirname, '../node_modules');
  const libsignalPath = path.join(nodeModulesPath, 'libsignal');
  const libsignalNodePath = path.join(nodeModulesPath, 'libsignal-node');
  const baileysPath = path.join(nodeModulesPath, '@whiskeysockets/baileys/node_modules/libsignal');
  
  // Potential source paths where the package might be hiding
  const candidates = [libsignalNodePath, baileysPath];
  
  if (fs.existsSync(libsignalPath)) {
    console.log(chalk.blue('libsignal already exists at:'), libsignalPath);
    // Check if it's a symlink
    const stats = fs.lstatSync(libsignalPath);
    if (stats.isSymbolicLink()) {
      console.log(chalk.yellow('libsignal is a symlink. Replacing with hard copy to fix electron build.'));
      const realPath = fs.realpathSync(libsignalPath);
      
      // Remove symlink
      try {
        fs.rmSync(libsignalPath, { recursive: true, force: true });
      } catch (e) {
        console.warn(chalk.red('Failed to remove symlink via fs.rmSync, trying shell rm...'));
        await $`rm -rf ${libsignalPath}`;
      }

      try {
        fs.cpSync(realPath, libsignalPath, { recursive: true });
        console.log(chalk.green('Successfully replaced symlink with hard copy.'));
      } catch (e) {
        console.error(chalk.red('Failed to copy libsignal:'), e);
        // Fallback: restore symlink
        fs.symlinkSync(realPath, libsignalPath, 'junction');
      }
    }
    return;
  }

  // If libsignal doesn't exist, try to find it elsewhere and copy
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      console.log(chalk.cyan(`Found candidate at ${src}. Copying to ${libsignalPath}...`));
      try {
        // If it's a symlink, resolve it first
        const realSrc = fs.realpathSync(src);
        fs.cpSync(realSrc, libsignalPath, { recursive: true });
        console.log(chalk.green('Success: libsignal is now available.'));
        return;
      } catch (e) {
        console.error(chalk.red(`Failed to copy from ${src}:`), e);
      }
    }
  }

  console.warn(chalk.yellow('Warning: Could not find libsignal source to copy. The build might fail if Baileys needs it.'));
}

await ensureLibsignal();
