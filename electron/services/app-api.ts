import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createAppApi() {
  return {
    openClawDoctor: async (payload?: unknown) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      return body.mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
    },
  };
}
