// Send SIGTERM to OpenClaw's own shutdown handler, including on Windows.
import { pathToFileURL } from 'node:url';
const [entry, port, token] = process.argv.slice(2);
process.on('message', (message) => {
  if (message === 'stop') {
    process.emit('SIGTERM');
    process.disconnect();
  }
});
process.argv = [process.execPath, entry, 'gateway', '--port', port, '--token', token, '--allow-unconfigured'];
await import(pathToFileURL(entry));
