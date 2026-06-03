import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { isRecord } from './payload-utils';

type OpenClawDoctorPayload = {
  mode?: unknown;
};

export function createAppApi(): CompleteHostServiceRegistry['app'] {
  return {
    openClawDoctor: async (payload) => {
      const body = isRecord(payload) ? payload as OpenClawDoctorPayload : {};
      return body.mode === 'fix' ? runOpenClawDoctorFix() : runOpenClawDoctor();
    },
  };
}
