import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

async function gitLines(args, cwd = ROOT) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getChangedFiles(since = 'origin/main', cwd = ROOT) {
  const files = new Set();
  for (const line of await gitLines(['diff', '--name-only', `${since}...HEAD`], cwd)) files.add(line);
  for (const line of await gitLines(['diff', '--cached', '--name-only'], cwd)) files.add(line);
  for (const line of await gitLines(['diff', '--name-only'], cwd)) files.add(line);
  for (const line of await gitLines(['ls-files', '--others', '--exclude-standard'], cwd)) files.add(line);
  return [...files].sort();
}
