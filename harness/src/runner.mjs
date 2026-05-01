import { spawn } from 'node:child_process';

export async function runStep(step) {
  const started = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('close', (exitCode) => {
      resolve({
        ...step,
        status: exitCode === 0 ? 'pass' : 'fail',
        exitCode,
        durationMs: Date.now() - started,
      });
    });
  });
}
