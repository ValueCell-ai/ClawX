import { resolve } from 'node:path';
import { normalizePath } from 'vite';

/** Runtime bundles can contain thousands of files unrelated to source HMR. */
export function getDevWatchIgnored(root: string): RegExp {
  const normalizedRoot = normalizePath(resolve(root)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${normalizedRoot}/(?:build|release|dist-electron|artifacts|playwright-report)(?:/|$)`,
    process.platform === 'win32' ? 'i' : '',
  );
}
