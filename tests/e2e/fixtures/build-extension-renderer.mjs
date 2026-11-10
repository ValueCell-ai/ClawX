import react from '@vitejs/plugin-react';
import { isAbsolute, join, resolve } from 'node:path';
import { build } from 'vite';

const repoRoot = resolve(process.cwd());
const outDir = process.argv[2];
if (!outDir || !isAbsolute(outDir)) {
  throw new Error('Expected an absolute per-test renderer output directory');
}

await build({
  configFile: false,
  root: repoRoot,
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  resolve: {
    alias: [
      { find: './extensions/_ext-bridge.generated', replacement: join(repoRoot, 'tests/e2e/fixtures/renderer-extension.tsx') },
      { find: '@', replacement: join(repoRoot, 'src') },
      { find: '@shared', replacement: join(repoRoot, 'shared') },
    ],
    dedupe: ['react', 'react-dom', 'react-i18next', 'zustand', 'sonner', 'lucide-react'],
  },
  build: { outDir, emptyOutDir: false, minify: false, reportCompressedSize: false },
});
