import { runOpenClawCommand, type OpenClawCommandResult } from './openclaw-command';

const OPENCLAW_DOCTOR_TIMEOUT_MS = 60_000;
// `doctor --fix` performs offline state and agent database migrations.
const OPENCLAW_DOCTOR_FIX_TIMEOUT_MS = 10 * 60_000;
const OPENCLAW_DOCTOR_ARGS = ['doctor'];
const OPENCLAW_DOCTOR_FIX_ARGS = ['doctor', '--fix', '--yes', '--non-interactive'];

export type OpenClawDoctorMode = 'diagnose' | 'fix';

export interface OpenClawDoctorResult extends OpenClawCommandResult {
  mode: OpenClawDoctorMode;
}

async function runDoctorCommandWithArgs(
  mode: OpenClawDoctorMode,
  args: string[],
): Promise<OpenClawDoctorResult> {
  const result = await runOpenClawCommand(args, {
    label: 'doctor',
    timeoutMs: mode === 'fix' ? OPENCLAW_DOCTOR_FIX_TIMEOUT_MS : OPENCLAW_DOCTOR_TIMEOUT_MS,
  });
  return { mode, ...result };
}

export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs('diagnose', OPENCLAW_DOCTOR_ARGS);
}

export async function runOpenClawDoctorFix(): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs('fix', OPENCLAW_DOCTOR_FIX_ARGS);
}
