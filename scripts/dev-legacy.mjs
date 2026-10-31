import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { legacyEnvironment, prepareLegacyProfile } from './lib/legacy-profile.mjs';

const runtime = JSON.parse(await readFile(new URL('../node_modules/openclaw/package.json', import.meta.url), 'utf8'));
const profile = await prepareLegacyProfile({ runtimeVersion: runtime.version });
console.info(`[dev:legacy] ${profile.reused ? 'Reusing' : 'Prepared'} ${profile.root}`);
console.info(`[dev:legacy] Migrated-state backup: ${profile.backup}`);
if (!process.argv.includes('--prepare-only')) {
  for (const port of [19789, 5174, 9224]) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(`Legacy port ${port} is occupied; close the existing legacy instance first`)));
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    stdio: 'inherit', env: legacyEnvironment(profile.root),
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
