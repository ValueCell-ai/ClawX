/**
 * Self-hosted Monaco Editor loader.
 *
 * `@monaco-editor/react` defaults to fetching Monaco from a CDN, which
 * is unusable in clawx's offline Electron environment.  We instead bundle
 * the editor + its language workers locally via Vite's `?worker` import
 * so each preview overlay can spin up Monaco without any network.
 *
 * Importing this module once is enough — `loader.config({ monaco })`
 * registers the bundled Monaco instance globally.
 */
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import { loader } from '@monaco-editor/react';

interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new jsonWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export { monaco };
export { Editor, DiffEditor, loader } from '@monaco-editor/react';

const EXT_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'plaintext',
  '.xml': 'xml',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.dart': 'dart',
  '.php': 'php',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.vue': 'html',
  '.dockerfile': 'dockerfile',
};

export function languageForExt(ext: string): string {
  if (!ext) return 'plaintext';
  const lower = ext.toLowerCase();
  return EXT_LANGUAGE_MAP[lower] ?? 'plaintext';
}

export function languageForPath(path: string): string {
  if (!path) return 'plaintext';
  const norm = path.replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/dockerfile') || norm === 'dockerfile') return 'dockerfile';
  const dot = norm.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  return languageForExt(norm.slice(dot));
}
