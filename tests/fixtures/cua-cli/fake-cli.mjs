#!/usr/bin/env node
// Synthetic CLI boundary only: no CUA package, native input, or daemon startup.
import { connect } from 'node:net';

const [flag, endpoint, verb, tool, json] = process.argv.slice(2);
if (flag !== '--socket' || verb !== 'call' || !endpoint || !json) {
  throw new Error('Expected --socket ENDPOINT call TOOL JSON');
}
const socket = connect(endpoint);
socket.setTimeout(5000, () => socket.destroy(new Error('Synthetic endpoint timeout')));
socket.on('connect', () => socket.write(`${JSON.stringify({
  tool, args: JSON.parse(json), pid: process.pid, endpoint,
})}\n`));
socket.on('data', (data) => process.stdout.write(data));
socket.on('error', (error) => {
  process.stderr.write(error.message);
  process.exitCode = 1;
});
