#!/usr/bin/env node
/**
 * Patch OpenClaw's OpenAI image provider to request b64_json responses.
 *
 * Many OpenAI-compatible relays (e.g. taolat) default to { url } only. OpenClaw's
 * parseOpenAiCompatibleImageResponse() only reads data[].b64_json, so generation
 * fails with "Image generation provider returned no images." even when HTTP 200.
 *
 * Dev: postinstall patches node_modules/openclaw/dist.
 * Production: bundle-openclaw.mjs applies the same replacement on build/openclaw.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SEARCH = `const body = {
					prompt: req.prompt,
					n: count,
					size
				};`;

const REPLACE = `const body = {
					prompt: req.prompt,
					n: count,
					size,
					response_format: "b64_json"
				};`;

function patchDistDir(distDir) {
  let patchedCount = 0;
  for (const file of readdirSync(distDir)) {
    if (!file.endsWith('.js')) continue;
    const filePath = join(distDir, file);
    let content = readFileSync(filePath, 'utf-8');
    if (!content.includes(SEARCH)) continue;
    content = content.replace(SEARCH, REPLACE);
    writeFileSync(filePath, content, 'utf-8');
    patchedCount += 1;
    console.log(`[patch-openclaw-image-b64-json] Patched: ${file}`);
  }
  return patchedCount;
}

const distDir = join(process.cwd(), 'node_modules', 'openclaw', 'dist');
let patchedCount = 0;
try {
  patchedCount = patchDistDir(distDir);
} catch (error) {
  console.warn('[patch-openclaw-image-b64-json] Skipped:', error instanceof Error ? error.message : error);
}

if (patchedCount === 0) {
  console.warn('[patch-openclaw-image-b64-json] No files patched (openclaw layout may have changed).');
} else {
  console.log(`[patch-openclaw-image-b64-json] Done. Patched ${patchedCount} file(s).`);
}
