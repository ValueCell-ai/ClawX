import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

async function gitLines(args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: ROOT, encoding: 'utf8' });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getChangedFiles(since = 'origin/main') {
  const files = new Set();
  for (const line of await gitLines(['diff', '--name-only', `${since}...HEAD`])) files.add(line);
  for (const line of await gitLines(['diff', '--name-only'])) files.add(line);
  for (const line of await gitLines(['ls-files', '--others', '--exclude-standard'])) files.add(line);
  return [...files].sort();
}
