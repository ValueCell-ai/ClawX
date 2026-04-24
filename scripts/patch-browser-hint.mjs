#!/usr/bin/env node
/**
 * Patch OpenClaw's BROWSER_TOOL_MODEL_HINT to allow retries on transient errors.
 *
 * The original hint ("Do NOT retry the browser tool — it will keep failing")
 * causes models to permanently refuse browser usage after a single transient error.
 *
 * This runs as postinstall to patch node_modules for dev mode.
 * Production builds are separately patched in bundle-openclaw.mjs.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPLACEMENTS = [
  [
    'Do NOT retry the browser tool \u2014 it will keep failing. Use an alternative approach or inform the user that the browser is currently unavailable.',
    'If this was a transient error (timeout, network), you may retry once. If the same error persists after retry, try an alternative approach and let the user know.',
  ],
  [
    'Do NOT retry the browser tool.',
    'You may retry once if this was a transient error.',
  ],
];

const distDir = join(process.cwd(), 'node_modules', 'openclaw', 'dist');

let patchedCount = 0;
try {
  for (const file of readdirSync(distDir)) {
    if (!file.endsWith('.js')) continue;
    const filePath = join(distDir, file);
    let content = readFileSync(filePath, 'utf-8');
    let changed = false;
    for (const [search, replace] of REPLACEMENTS) {
      if (content.includes(search)) {
        content = content.replaceAll(search, replace);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(filePath, content, 'utf-8');
      console.log(`[patch-browser-hint] Patched: ${file}`);
      patchedCount++;
    }
  }
} catch {
  // openclaw not installed yet or dist not found — skip silently
}

if (patchedCount > 0) {
  console.log(`[patch-browser-hint] Done. Patched ${patchedCount} file(s).`);
}
